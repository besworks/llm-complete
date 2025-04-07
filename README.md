# LLM Complete

A command-line tool for generating text completions using local LLM models. Supports direct prompts, and file input/output.

## Purpose

LLM completions are continuations of text from a given prompt or existing content. Unlike chat models that answer questions, completion models excel at:

- Continuing partial sentences or paragraphs
- Generating creative writing from prompts
- Adding to existing documentation
- Completing code snippets

### Example Input
```
$ llm-complete -p "export class SillyButton extends HTMLElement {"
```

### Example Output
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

## Requirements

You must have [NodeJS](https://nodejs.org/) and [GPT4All](https://www.nomic.ai/gpt4all) installed. There are various methods to do this. You could [build from source](https://github.com/nomic-ai/gpt4all). I installed via [AUR](https://aur.archlinux.org/packages/gpt4all-chat).

This tool is based around [Mistral 7B by Mistral.AI](https://mistral.ai/news/announcing-mistral-7b). The [GGUF](https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF) needs to be installed in the GPT4All path. 

```bash
curl -L https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF/blob/main/mistral-7b-v0.1.Q4_K_M.gguf?download=true \
     -o ~/.local/share/nomic.ai/GPT4All/mistral-7b-v0.1.Q4_K_M.gguf
```

On Arch, GPT4All stores models in the path above. This may be different in your installation. Also, the node module expects models in `~/.cache/gpt4all/` so we need to link them there for this app to work.

```bash
ln -s ~/.local/share/nomic.ai/GPT4All/mistral-7b-v0.1.Q4_K_M.gguf ~/.cache/gpt4all/
```

## Model Choice

This version has specifically been selected for it's balance of light weight and creativity in addition to it's open source license. There are newer and larger versions of this model but they don't perform as well on a laptop with no dedicated GPU. Feel free to use any **base** LLM instead if you wish, or a larger quant but Chat/Agent trained models will not work as expected with this code. If you do this you will need to supply your own model configuration in [models.json](models.json)

## Installation

```bash
# Clone repository
git clone https://github.com/besworks/llm-complete.git
```

OR

```bash
# Install via npm
npm i -g llm-complete
```

## Usage

```bash
# No prompt for random output
llm-complete

# Direct prompt with quotes
llm-complete -p "This is a test"

# Process file to stdout (allows redirection)
llm-complete -f input.txt # output to terminal
llm-complete -f input.txt > output.txt # overwrite
llm-complete -f input.txt >> output.txt # append

# Append completion to input file
llm-complete -a story.txt

# Select processing device [cpu|gpu]
DEVICE=cpu llm-complete -f input.txt

# Customize buffer size
BUFFER=40 llm-complete

# Customize output length
PREDICT=512 llm-complete -p "This is a longer test"

# Use a different model
export MODEL="mistral-7b-v0.2-Q6_K.gguf"
export CTX=1024
llm-complete
```

## Architecture

For anyone interested, I have written a [full breakdown](DEVELOPMENT.md) of how this works.