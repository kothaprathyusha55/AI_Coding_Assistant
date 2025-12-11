import * as vscode from 'vscode';
import axios from 'axios';
import { Readable } from 'stream';

export function activate(context: vscode.ExtensionContext) {
  // Command id MUST match package.json: "rp2-ai-helper.openPanel"
  const disposable = vscode.commands.registerCommand('rp2-ai-helper.openPanel', () => {
    const panel = vscode.window.createWebviewPanel(
      'rp2AiHelper',
      'RP2 AI Helper Panel',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    // Set the HTML content for the webview
    panel.webview.html = getWebViewContent();

    // Listen for messages coming from the webview
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.command === 'chat') {
        const userPrompt: string = message.text ?? '';
        let responseText = '';

        try {
          // Call your local LLM (Ollama) with streaming response
          const streamResponse = await axios({
            method: 'post',
            url: 'http://localhost:11434/api/generate',
            data: {
              model: "llama3",   // change if your model id is different
              prompt: userPrompt,
              max_tokens: 512
            },
            responseType: 'stream'
          });

          const reader = streamResponse.data as Readable;
          let buffer = '';

          reader.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();

            // Ollama sends JSON per line – split by newline
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const jsonChunk = JSON.parse(trimmed);

                if (!jsonChunk.response) continue;

                let textPart: string = jsonChunk.response;

                // Remove <think>...</think> blocks if present
                textPart = textPart.replace(/<think>[\s\S]*?<\/think>/g, '');
                if (!textPart.trim()) continue;

                responseText += textPart;

                // Send incremental response back to webview
                panel.webview.postMessage({
                  command: 'chatResponse',
                  text: responseText
                });
              } catch (err) {
                console.error('Error parsing JSON chunk:', err);
              }
            }
          });

          reader.on('end', () => {
            panel.webview.postMessage({
              command: 'chatResponse',
              text: responseText || 'No response from model.'
            });
          });

          reader.on('error', (err) => {
            console.error('Stream error:', err);
            panel.webview.postMessage({
              command: 'chatResponse',
              text: `Error reading stream: ${String(err)}`
            });
          });

        } catch (err) {
          console.error('Error calling LLM:', err);
          panel.webview.postMessage({
            command: 'chatResponse',
            text: `Error calling model: ${String(err)}`
          });
        }
      }
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}

// Webview UI with proper messaging to the extension
function getWebViewContent(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>RP2 AI Helper Panel</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 1rem;
    }
    #prompt {
      width: 100%;
      box-sizing: border-box;
    }
    #response {
      border: 1px solid #ccc;
      margin-top: 1rem;
      padding: 0.5rem;
      min-height: 3rem;
      white-space: pre-wrap;
    }
    #askBtn {
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <h2>RP2 AI Helper Panel</h2>
  <textarea id="prompt" rows="3" placeholder="Ask something..."></textarea><br/>
  <button id="askBtn">Ask</button>
  <div id="response"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const promptEl = document.getElementById('prompt');
    const responseEl = document.getElementById('response');
    const askBtn = document.getElementById('askBtn');

    askBtn.addEventListener('click', () => {
      const text = promptEl.value.trim();
      if (!text) {
        responseEl.innerText = 'Please type a question first.';
        return;
      }
      // Tell the extension to start chatting
      responseEl.innerText = 'Thinking...';
      vscode.postMessage({ command: 'chat', text });
    });

    // Listen for messages from the extension (LLM responses)
    window.addEventListener('message', event => {
      const { command, text } = event.data;
      if (command === 'chatResponse') {
        responseEl.innerText = text;
      }
    });
  </script>
</body>
</html>
`;
}
