# ⚡ Promptly — Backend Proxy Server

This is the secure backend proxy server for the **Promptly** browser extension. It relays prompt optimization requests to Groq API using a private API key, keeping the key hidden from users and GitHub.

---

## 🚀 Easy 1-Click Deployment (Vercel)

The easiest way to host this proxy is on **Vercel** (which is 100% free for personal usage).

1. Install the [Vercel CLI](https://vercel.com/cli) on your system:
   ```bash
   npm install -g vercel
   ```
2. Navigate to this directory in your terminal:
   ```bash
   cd promptly/proxy
   ```
3. Run the deployment command:
   ```bash
   vercel
   ```
4. Follow the terminal prompts to log in and set up a new project (use defaults).
5. **Set the Environment Variable:**
   In your Vercel Dashboard (or via CLI):
   * Go to **Settings** → **Environment Variables**.
   * Add a new key: `GROQ_API_KEY`
   * Value: `YOUR_ACTUAL_GROQ_API_KEY_HERE` (starts with `gsk_`)
   * Click Save.
6. Re-deploy to apply the environment variable changes:
   ```bash
   vercel --prod
   ```
7. Copy your deployed Vercel domain (e.g. `https://your-project.vercel.app`).
8. Paste this URL into the `PROXY_API_URL` constant inside the extension's [background.js](file:///C:/Users/madha/.gemini/antigravity-ide/scratch/promptly/background.js) file.

---

## 🔒 Security Configuration

CORS headers inside `api/optimize.js` are configured to permit request incoming from extension origins:
* `Access-Control-Allow-Origin: *` allows browser extension environments to make requests natively.
* `GROQ_API_KEY` is read strictly on the server-side, preventing it from ever being exposed to client browsers or network logs.
