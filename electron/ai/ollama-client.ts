const OLLAMA_BASE_URL = 'http://localhost:11434';

interface OllamaStatus {
  running: boolean;
  error?: string;
}

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface ChatResponse {
  response: string;
  done: boolean;
  error?: string;
}

class OllamaClient {
  /**
   * Check if Ollama is running and accessible.
   */
  async checkStatus(): Promise<OllamaStatus> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        return { running: true };
      }
      return { running: false, error: `Ollama returned status ${response.status}` };
    } catch (error: any) {
      return {
        running: false,
        error: error.message || 'Ollama is not running. Install it from ollama.com',
      };
    }
  }

  /**
   * List all available models.
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
      if (!response.ok) {
        return [];
      }

      const data = await response.json() as any;
      return (data.models || []).map((m: any) => ({
        name: m.name,
        size: m.size,
        modified_at: m.modified_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Send a chat message and get a response.
   */
  async chat(model: string, prompt: string): Promise<ChatResponse> {
    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        return { response: '', done: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json() as any;
      return {
        response: data.message?.content || '',
        done: true,
      };
    } catch (error: any) {
      return {
        response: '',
        done: false,
        error: error.message || 'Failed to get response from Ollama',
      };
    }
  }

  /**
   * Stream a chat message token by token.
   * Calls onToken for each chunk, returns the full text when done.
   * Returns an AbortController so the caller can cancel.
   */
  chatStream(
    model: string,
    prompt: string,
    history: { role: string; content: string }[],
    onToken: (token: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): AbortController {
    const controller = new AbortController();

    (async () => {
      try {
        const messages = [...history, { role: 'user', content: prompt }];
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: true }),
          signal: controller.signal,
        });

        if (!response.ok) {
          onError(`HTTP ${response.status}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onError('No response body');
          return;
        }

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(l => l.trim());

          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.message?.content) {
                fullText += json.message.content;
                onToken(json.message.content);
              }
              if (json.done) {
                onDone(fullText);
                return;
              }
            } catch {
              // skip malformed lines
            }
          }
        }

        onDone(fullText);
      } catch (error: any) {
        if (error.name === 'AbortError') {
          onDone('');
        } else {
          onError(error.message || 'Stream failed');
        }
      }
    })();

    return controller;
  }
}

let client: OllamaClient | null = null;

export function getOllamaClient(): OllamaClient {
  if (!client) {
    client = new OllamaClient();
  }
  return client;
}
