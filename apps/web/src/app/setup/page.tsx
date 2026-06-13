"use client";

import { useState } from "react";

export default function SetupPage() {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/setup/secrets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, apiKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data?.error || "Failed to save settings");
        setSaving(false);
        return;
      }

      setMessage("Saved. Please restart Olly.");
    } catch {
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  const providerLabel =
    provider === "anthropic" ? "Claude / Anthropic API Key" : "OpenAI API Key";

  const providerPlaceholder =
    provider === "anthropic"
      ? "Paste your Claude / Anthropic API key"
      : "Paste your OpenAI API key";

  return (
    <main style={{ maxWidth: 520, margin: "80px auto", padding: 24 }}>
      <h1>Set up Olly</h1>
      <p>Enter your LLM provider and API key to continue.</p>

      <form
        onSubmit={handleSave}
        style={{ display: "grid", gap: 16, marginTop: 24 }}
      >
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 8, padding: 10 }}
          >
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label>
          {providerLabel}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={providerPlaceholder}
            style={{ display: "block", width: "100%", marginTop: 8, padding: 10 }}
          />
        </label>

        <button
          type="submit"
          disabled={saving || !apiKey.trim()}
          style={{ padding: 12 }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      {message ? <p style={{ marginTop: 16 }}>{message}</p> : null}
    </main>
  );
}