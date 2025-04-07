import { loadModel, createCompletionStream } from 'gpt4all';
import { open as openFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

// Track generation status
const state = {
    busy: false,    // Block input during generation
    killed: false,  // Generation cancellation
    flashOn: false, // Loading animation state
    flashLoop: null // Loading animation timer
};

// Try to prevent segfault on unexpected errors
process.on('uncaughtException', err => {
    console.error(err);
    if (state.busy) {
        shutdown();
    } else {
        process.exit();
    }
});

// Set model processing mode
// Can be 'cpu' | 'gpu' | 'amd' | 'nvidia' | 'intel' | '<other_gpu_name>'
// The best avaiable gpu will be used by default
// Falls back to cpu if no gpu available
const device = process.env.DEVICE ?? 'gpu';

// Get model config path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const modelConfigPath = join(__dirname, "models.json");

// Select Model
const modelName = process.env.MODEL ?? 'mistral-7b-v0.1.Q4_K_M.gguf';
const ctx = process.env.CTX ?? 2048; // 2048 is max for Mistral 7b

// Initialize model using GPT4All bindings
const model = await loadModel(modelName, {
    modelConfigFile: modelConfigPath, // Per-model settings
    allowDownload: false, // We will manually download gguf file
    verbose: false,       // Supress detailed output from model
    device: device,       // Processing device, set by ENV variable
    nCtx: ctx,            // Max context size, varies by model
    ngl: 100              // Number of gpu layers to use
});

// Parse command line args
const args = process.argv.slice(2);
const flags = {
    prompt : [ '-p', '--prompt' ],
      file : [ '-f', '--file'   ],
    append : [ '-a', '--append' ]
};
let inputPath, directInput, inputFile, outputFile;
const useFile = args.some(arg => flags.file.includes(arg));
const append = args.some(arg => flags.append.includes(arg));
const prompt = args.some(arg => flags.prompt.includes(arg));
const inputIndex = getInputIndex();

// Get arg index for filename
function getInputIndex() {
    if (append) return args.findIndex(arg => flags.append.includes(arg)) + 1;
    if (useFile) return args.findIndex(arg => flags.file.includes(arg)) + 1;
    if (prompt) return args.findIndex(arg => flags.prompt.includes(arg)) + 1;
    return -1;
}

// Proceed with or without input
if (useFile || append) {
    // Get file path from args
    inputPath = args[inputIndex];
    if (!inputPath) {
        console.error('Error: No input file specified after ', args[inputIndex-1]);
        process.exit(1);
    }
} else {
    // Use string input from command line or empty input
    directInput = prompt ? args[inputIndex] : '';
}

// Load input file
if (inputPath) {
    try {
        inputFile = await openFile(inputPath, append ? 'a+' : 'r');
    } catch(err) {
        console.error('Error opening file:', err);
        process.exit(1);
    }
}

// Set generation settings
const predict = process.env.PREDICT ?? 128;

const settings = {
    temperature: 0.7,    // Controls creativity (0.0-1.0)
    topK: 40,            // Limits vocabular to top K tokens
    topP: 0.9,           // High probability cutoff
    minP: 0.1,           // Low probability cutoff
    repeatPenalty: 1.2,  // Penalize repeated tokens, 1 = No Penalty
    repeatLastN: 64,     // Lookback window for repeats
    nBatch: 2048,        // Tokens to process concurrently, higher values use more RAM
    nPredict: predict,   // Maximum tokens to generate, increase for longer output
    contextErase: 0.75,  // Percentage of past context to erase if exceeded
    promptTemplate: '%1' // Can override prompt template from config file
};

// Initialize terminal interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '',
    completer: () => [[], '']
});

// Prevent input while generating
const tty = rl._ttyWrite;
function blockInput() {
    rl._ttyWrite = () => {}; // Block all TTY writes
    process.stderr.write('\x1b[?25l'); // Hide cursor
}

// Stop blocking input
function restoreInput() {
    rl._ttyWrite = tty; // Reattach TTY handler
    process.stderr.write('\x1b[?25h'); // Restore cursor
}

// Handle terminal input
rl.input.on('data', key => {
    const keyStr = key.toString();
    if (state.busy) {
        // Graceful shutdown with Ctrl+C
        if (keyStr === '\x03') {
            state.killed = true;
            return;
        }
    }
});

// Allow interrupting completion
settings.onResponseToken = (tokenId, token) => {
    // Can process token here if needed
    return !state.killed;
};

// Show flashing elipses
function startIndicating() {
    // User stderr to work with background processing
    state.flashLoop = setInterval(() => {
        if (state.flashOn) {
            state.flashOn = false;
            process.stderr.write('   \b\b\b');
        } else {
            state.flashOn = true;
            process.stderr.write('...\b\b\b');
        }
    }, 400);
}

// Hide elipses
function stopIndicating() {
    clearInterval(state.flashLoop);
    state.flashOn = false;
}

// File stream for appending to input
async function createWriteStream() {
    try {
        // Check if last 2 bytes are newlines and truncate one
        const eof = (await inputFile.stat()).size - 2;
        if (eof > 1) {
            const tempFile = Buffer.alloc(2);
            const lastBytes = (await inputFile.read(tempFile,0,2,eof)).buffer;
            const isSingleNewline = (lastBytes[0] !== 0x0A && lastBytes[1] === 0x0A);
            if (isSingleNewline) { await inputFile.truncate(eof+1); }
        }
        outputFile = inputFile.createWriteStream();
    } catch (err) {
        console.error('Error creating WriteStream:', err);
        shutdown();
    }
}

// Handle generated tokens
function writeToken(token) {
    if (append) {
        // Append output to input file
        try { outputFile.write(token); } catch (err) {
            console.error('Error writing to output file:', err);
            shutdown();
        }
    } else if (!process.stdout.isTTY) {
        // Handle redirected output
        process.stdout.write(token);
    } else {
        // Write output to terminal
        rl.line += token;
        rl.cursor = rl.line.length;
        rl._refreshLine();
    }
}

// Graceully unload model on exit
function shutdown() {
    if (state.busy) {
        // Give native model process time to settle
        // before disposing to prevent segfault
        setTimeout(dispose, 800);
    } else {
        dispose();
    }
}

// Cleanup before exit
function dispose() {
    model.dispose();
    restoreInput();
    process.exit();
}

// Set sentence boundaries for trimming fragmented output
const boundaries = /[.?!…:;\n]/;

// Stream buffered tokens to output
async function processStream(input) {
    state.busy = true;
    
    // Trim only single trailing newlines
    input = input.replace(/[^\n](\n)$/,'');
    
    try {
        if (append) {
            // Append to input file
            await createWriteStream();
        } else {
            // Write input to stdout
            writeToken(input);
        }
        
        // Apply prompt to model
        const stream = createCompletionStream(
            model, input, settings
        );

        // Configure output buffer
        const bufferAhead = process.env.BUFFER ?? 30;
        let buffer = [];
        let currentToken = -1;
        let currentIndex = 0;
        let currentBoundary = -1;

        // Loop until all tokens are received
        for await (let token of stream.tokens) {
            if (state.killed) return;

            // Prevent double space between input and output
            if (currentToken < 0 &&
                token.startsWith(' ') &&
                input.endsWith(' ')
            ) {
                token = token.toString().slice(1);
            }

            // Buffer tokens
            buffer.push(token);
            currentToken++;

            // Detect position of last sentence boundary
            if (token.match(boundaries)) {
                currentBoundary = buffer.length;
            }

            // Hide loading indicator before outputing to terminal
            if (currentToken == bufferAhead && !append && process.stdout.isTTY) {
                stopIndicating();
            }

            // Don't start outputting until buffer is full
            if (currentToken >= bufferAhead) {
                writeToken(buffer[currentIndex]);
                currentIndex++;
            }
        }
        
        // Drop any trailing sentence fragment from buffer
        if (currentBoundary) {
            const boundary = currentBoundary ? currentBoundary : buffer.length-1
            buffer = buffer.slice(currentIndex, boundary);
            while (buffer.slice(-1)[0]?.match(/\n/)) {
                buffer.pop();
            }
        }

        // Process remaining buffer by continuing to output one token at time
        for (let i = 0; i < buffer.length; i++) {
            if (state.killed) return;
            await new Promise(resolve => {
                setTimeout(() => {
                    writeToken(buffer[i]);
                    resolve();
                }, 200);
            });
        }
    } catch (error) {
        handleProcessingError(error);
    } finally {
        proccessingStopped();
    }
}

// Shutt down gracefully if we encounter an error during procesing
function handleProcessingError(err) {
    console.error('Error processing stream:', err.message);
    shutdown();
}

// Reset terminal state after generation
function proccessingStopped() {
    writeToken('\n');
    stopIndicating();
    restoreInput();
    shutdown();
}

// Process input 
blockInput();
startIndicating();
if (inputFile) {
    try {
        // load file async to prevent blocking loading indicator
        inputFile.readFile('utf8')
        .then(input => processStream(input));
    } catch (error) {
        console.error('Error reading file:', error.message);
        process.exit(1);
    }
} else {
    processStream(directInput);
}
