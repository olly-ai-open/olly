import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

function getSecretsDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "olly");
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "olly",
    );
  }

  return path.join(os.homedir(), ".config", "olly");
}

function getSecretsFilePath() {
  return path.join(getSecretsDir(), "secrets.env");
}

function ensureSecretsFile() {
  const dir = getSecretsDir();
  const file = getSecretsFilePath();

  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "# Olly user secrets\n", "utf8");
  }

  return file;
}

function parseEnv(text: string) {
  const result: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function serializeEnv(obj: Record<string, string>) {
  return (
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("\n") + "\n"
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const provider = body?.provider;
    const apiKey = body?.apiKey?.trim();

    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: "Missing provider or API key" },
        { status: 400 },
      );
    }

    if (provider !== "anthropic" && provider !== "openai") {
      return NextResponse.json(
        { error: "Unsupported provider" },
        { status: 400 },
      );
    }

    const file = ensureSecretsFile();
    const current = parseEnv(fs.readFileSync(file, "utf8"));

    const nextValues: Record<string, string> = {
      ...current,
      LLM_PROVIDER: provider,
    };

    if (provider === "anthropic") {
      nextValues.ANTHROPIC_API_KEY = apiKey;
      delete nextValues.OPENAI_API_KEY;
    }

    if (provider === "openai") {
      nextValues.OPENAI_API_KEY = apiKey;
      delete nextValues.ANTHROPIC_API_KEY;
    }

    fs.writeFileSync(file, serializeEnv(nextValues), "utf8");

    return NextResponse.json({ ok: true, provider });
  } catch {
    return NextResponse.json(
      { error: "Failed to save secrets" },
      { status: 500 },
    );
  }
}