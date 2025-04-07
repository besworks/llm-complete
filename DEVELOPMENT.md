# Architecture

Spinning up a node app that does completions is pretty straightforward, but for CLI usage I ran into a few usability conditions that eventually led to the following code. I wanted this to be easy to use with a smooth user experience. Below is a complete outline of every code block explaining what it does and the reasoning behind it. I decided to release this a guide for anyone interested in the details. 

## Dependencies

Uses minimal imports. [GPT4All](https://www.nomic.ai/gpt4all) and it's [node bindings](https://www.npmjs.com/package/gpt4all) are the only external requirements.

```javascript
import { loadModel, createCompletionStream } from 'gpt4all';
import { open as openFile } from 'node:fs/promises';
import readline from 'node:readline';
```

## State Management

To create a smooth user experience.

```javascript
const state = {
    busy: false,    // Block input during generation
    killed: false,  // Handle cancellation gracefully
    flashOn: false, // Loading animation state
    flashLoop: null // Loading animation timer
};
```

## Error Handling

Gracefully shutdown on unexpected errors.

```javascript
process.on('uncaughtException', err => {
    console.error(err);
    if (state.busy) {
        shutdown();
    } else {
        process.exit();
    }
});
```

## Processing mode

Can be `'cpu'` | `'gpu'` | `'amd'` | `'nvidia'` | `'intel'` | `'<other_gpu_name>'`.

The best avaiable gpu will be used by default, falls back to cpu if no gpu available.

```javascript
const device = process.env.DEVICE ?? 'gpu';
```

## Model Configuration

Load a local model using GPT4All bindings. If you want to experiment with different models you could read these values in from ENV or json file easy enough.

```javascript
const modelName = process.env.MODEL ?? 'mistral-7b-v0.1.Q4_K_M.gguf';
const ctx = process.env.CTX ?? 2048; // 2048 is max for Mistral 7b

const model = await loadModel(modelName, {
    modelConfigFile: "./models.json", // Per-model settings
    allowDownload: false, // We will manually download gguf file
    verbose: false,       // Supress detailed output from model
    device: device,       // Processing device, set by ENV variable
    nCtx: ctx,            // Max context size, varies by model
    ngl: 100              // Number of gpu layers to use
});
```

The model must exist in GPT4All's model path. On arch this is `~/.local/share/nomic.ai/GPT4All/`. An entry for this model must exist in **models.json**. You can use the [metadata provided by nomic](https://raw.githubusercontent.com/nomic-ai/gpt4all/main/gpt4all-chat/metadata/models3.json) or specify your own in the following format if your model is not listed. The GPT4All wiki provides find guidance on [configuring custom models](https://github.com/nomic-ai/gpt4all/wiki/Configuring-Custom-Models).

```json
[
  {
    "order": "a",
    "name": "Mistral 7B",
    "filename": "mistral-7b-v0.1.Q4_K_M.gguf",
    "url": "https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF/blob/main/mistral-7b-v0.1.Q4_K_M.gguf?download=true",
    "md5sum": "a5b363017e471c713665d57433f76e65",
    "filesize": "4368438912",
    "requires": "2.5.0",
    "ramrequired": "8",
    "parameters": "7 billion",
    "quant": "q4_0",
    "type": "Mistral",
    "description": "For creative completions, developed by Mistral AI",
    "promptTemplate": "%1",
    "chatTemplate": "",
    "systemPrompt": ""
  }
]
```

This project uses [Mistral 7B Base](https://mistral.ai/news/announcing-mistral-7b) converted to [GGUF Format by TheBloke](https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF). There are plenty of models to choose from but for lightweight creative writing this one does quite well. It can be run on a decent laptop and is released under the Apache 2.0 license allowing commercial use. There are newer and larger models in this series but this one hits a good balance of resource usage and creativity.

The `systemPrompt` and `chatTemplate` options are not needed for basic completions. More on chat mode in the next article. This script does not generate responses with a personality. You cannot ask it a question and get a well formed response. To use this tool, you feed it incomplete text, and it will complete the text for you.

### Example Input

```
This is a story
```

### Example Output
```
This is a story about how my best friend and I are complete opposites.

My name...
```

## Tips for Better Completions

1. End your prompt mid-sentence for more natural continuations
2. Use markdown or code formatting to guide the style
3. Include examples of the desired output format
4. Keep context under 2048 tokens for best performance
5. Use append mode `-a` for iterative writing
6. Provide useful context details to guide the output

## Command Line Argument Processing

Completions can be done a few different ways:

- No input, random output to terminal
- String input from command line with `-p` or `--prompt` flag.
- File input with with `-f` or `--file` flag
- Output can be redirected with `> output.txt`
- Output can be appended to input file with `-a` or `--append` flag.

```javascript
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

function getInputIndex() {
    if (append) return args.findIndex(arg => flags.append.includes(arg)) + 1;
    if (useFile) return args.findIndex(arg => flags.file.includes(arg)) + 1;
    if (prompt) return args.findIndex(arg => flags.prompt.includes(arg)) + 1;
    return -1;
}
```

Not the DRYest way to handle this but it gets the job done.

## Input Validation

If file mode is specified, make sure a path was provided. For direct input, we can continue with or without a prompt.

```javascript
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
```

## Generator Settings

Here you can adjust the quality of your output. There are many resources online discussing these options. ChatGPT can give you a good breakdown if needed. The setting below are reasonable defaults, adjust to your use case.

```javascript
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
```

The big one to adjust here is `nPredict`. This decides how long your output will be. You can adjust this value with the `PREDICT` ENV var. The **128** token default setting will result in a decent size paragraph of text or equivalent (lists, code, etc). For example:

### Input
```
$ llm-complete -p "export class SillyButton extends HTMLElement {"
```

### Output
```javascript
export class SillyButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const template = document.createElement('template');
    template.innerHTML = `<style>
      :host {
        display: block;
        width: 100%;
        height: 56px;
        border-radius: 4px;
        background-color: #3278ff;
        color: white;
        font-size: 1.2rem;
      }
    </style>`;
    this.

```

You can continue generating in append mode to keep building off previous work. Using a text editor that supports streaming input like vscode or vim you can see the results in real time, make edits, save, then continue generating.

```shell
$ llm-complete -a silly-button.js # add some text
$ llm-complete -a silly-button.js # run again to add more
```

## Terminal Interface Setup

Connect input/output streams for writing to terminal. Override the default prompt and prevent tab completions.

```javascript
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    prompt: '',
    completer: () => [[], '']
});
```

## Input Control Functions

Block all keyboard input while processing and hide the cursor.

```javascript
function blockInput() {
    rl._ttyWrite = () => {};
    process.stderr.write('\x1b[?25l');
}

function restoreInput() {
    rl._ttyWrite = tty;
    process.stderr.write('\x1b[?25h');
}
```

Allow **Ctrl+C** to cancel generation even though all other input is blocked.

```javascript
rl.input.on('data', key => {
    const keyStr = key.toString();
    if (state.busy) {
        if (keyStr === '\x03') {
            state.killed = true;
            return;
        }
    }
});
```

## Interrupting Generation

Return false in this callback to stop the model from generating any more tokens. You can process the current token here to decide whether or not to stop generating. In this script, we trigger cancellation only with ctrl+c but this can be expanded on if needed.


```javascript
settings.onResponseToken = (tokenId, token) => {
    return !state.killed;
};
```

## Progress Indication

Show a flashing elipses while busy. Uses `stderr` to avoid poluting our output.

```javascript
function startIndicating() {
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

function stopIndicating() {
    clearInterval(state.flashLoop);
    state.flashOn = false;
}
```

## Streaming Append to File

In append mode, tokens are streamed directly back to the input file. Before this we check if the input file ends in a single newline. If so, truncate it. This allows us to pass a partial sentence as input while adhering to POSIX text file standards. We only strip single newlines. Double newlines are left intact to allow starting completion with a new paragraph.

### Single Newline Example 
Input:
```
This is a story

```
Output:
```
This is a story about something...
```

### Double Newline Example
Input:
```
# Test Plan:
- Do Tests
- More Tests


```
Output:
```
# Test Plan:
- Do Tests
- More Tests

# Test 1:
- Check the input
```

The model decides how to continue the text. If it determines that there should be a newline after the input, it will add one. Manipulating the input like this helps the model continue the text in a natural way.

To perform this check we read the last two bytes of the input file into a buffer.

```javascript
async function createWriteStream() {
    try {
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
```

## Write Output

Stream output to file, redirected stdout, or direct to terminal.

```javascript
function writeToken(token) {
    if (append) {
        try { outputFile.write(token); } catch (err) {
            console.error('Error writing to output file:', err);
            shutdown();
        }
    } else if (!process.stdout.isTTY) {
        process.stdout.write(token);
    } else {
        rl.line += token;
        rl.cursor = rl.line.length;
        rl._refreshLine();
    }
}
```

## Shutdown and Cleanup

Prevents segfault by allowing the model time to free it's own resources.

```javascript
function shutdown() {
    if (state.busy) {
        setTimeout(dispose, 800);
    } else {
        dispose();
    }
}

function dispose() {
    model.dispose();
    restoreInput();
    process.exit();
}
```

## Stream Processing

Completion will continue until `nPredict` tokens are generated. This can result in fragmented sentences at the end of output. To prevent this, we will detect sentence boundaries and drop any trailing fragments.

```javascript
const boundaries = /[.?!…:;\n]/;
```

To accomplish this task we must buffer the output. Default buffer is **30** tokens. This can be adjusted as necessary with the `BUFFER` ENV var. Output is delayed until the buffer is full. This allows us to drop the sentence fragment before output writing catches up. After all tokens are collected, we write the remaining buffer out on a timer to simulate the streaming effect of token generation.

```javascript
async function processStream(input) {
    state.busy = true;
    
    // For stdout, we need to trim newlines from
    // input like we do when appending to file
    input = input.replace(/[^\n](\n)$/,'');
    
    try {
        if (append) {
            // appending file already holds input
            await createWriteStream();
        } else {
            // write input to terminal
            writeToken(input);
        }
        
        // prompt the model
        const stream = createCompletionStream(
            model, input, settings
        );

        // Configure buffer
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
```

## Error Handling

Gracefully shutdown if errors are encountered during processing. 

```javascript
function handleProcessingError(err) {
    console.error('Error processing stream:', err.message);
    shutdown();
}
```

## Processing Completion

Write a final newline, reset terminal state and shutdown gracefully when processing stops.

```javascript
function proccessingStopped() {
    writeToken('\n');
    stopIndicating();
    restoreInput();
    shutdown();
}
```

## Process Initialization

We read the input file async to prevent blocking. This ensures the flashing indicator and cancel detection will work while loading. Start processing after the file is fully read.

```javascript
blockInput();
startIndicating();
if (inputFile) {
    try {
        inputFile.readFile('utf8')
        .then(input => processStream(input));
    } catch (error) {
        console.error('Error reading file:', error.message);
        process.exit(1);
    }
} else {
    processStream(directInput);
}
```

## Future Improvements

I originally had included inline editing of results on the terminal but this proved to be trickier than expected. The core functionality works, but there some quirks that need handling. I may release an update with this feature at some point if I can get it working properly.

## Installation

You can use this to base your own implementation on. I have released [the code](https://github.com/besworks/llm-complete) under the MIT License. Or you can [install via npm](https://www.npmjs.com/package/llm-complete) and start using it right away. Run it via the installed `llm-complete` executable.