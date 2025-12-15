const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/**
 * Minimal JSON-RPC MCP client for Streamable HTTP servers.
 * This is intentionally tiny: we only need tools/call for agent-mail automation.
 */
class McpHttpClient {
  /**
   * @param {{ url: string, headers?: Record<string,string> }} options
   */
  constructor({ url, headers = {} }) {
    this.url = url;
    this.headers = { ...headers };
    this.sessionId = null;
  }

  /**
   * @param {string} name
   * @param {Record<string, any>} argumentsObj
   */
  async callTool(name, argumentsObj) {
    const id = crypto.randomUUID();
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: argumentsObj || {} },
    };

    /** @type {Record<string,string>} */
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...this.headers,
    };

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const { statusCode, responseHeaders, text } = await this.#postJson(this.url, headers, body);
    const sessionId = responseHeaders['mcp-session-id'] || responseHeaders['Mcp-Session-Id'];
    if (sessionId) this.sessionId = sessionId;

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error(`MCP server returned non-JSON response (HTTP ${statusCode}).`);
      // @ts-ignore
      err.details = { status: statusCode, text: text.slice(0, 2000) };
      throw err;
    }

    if (!statusCode || statusCode < 200 || statusCode >= 300) {
      const err = new Error(`MCP HTTP error ${statusCode}`);
      // @ts-ignore
      err.details = { status: statusCode, json };
      throw err;
    }

    if (json.error) {
      const err = new Error(json.error.message || 'MCP tool call failed');
      // @ts-ignore
      err.details = json.error;
      throw err;
    }

    return json.result;
  }

  /**
   * @param {string} urlString
   * @param {Record<string,string>} headers
   * @param {any} bodyJson
   * @returns {Promise<{statusCode: number, responseHeaders: Record<string, any>, text: string}>}
   */
  #postJson(urlString, headers, bodyJson) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlString);
      const mod = u.protocol === 'https:' ? https : http;
      const payload = JSON.stringify(bodyJson);

      const req = mod.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port ? Number.parseInt(u.port, 10) : undefined,
          path: `${u.pathname}${u.search}`,
          method: 'POST',
          headers: {
            ...headers,
            'content-length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              responseHeaders: res.headers || {},
              text,
            });
          });
        },
      );

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

module.exports = { McpHttpClient };
