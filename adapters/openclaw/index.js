"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  BUNDLE_SCHEMA,
  buildImportedContext,
  createBundle,
  getExportDirectory,
  readBundle,
  shortHash,
  takePendingImport,
  writeBundle
} = require("../../packages/core/src");
const nativeHistory = require("./history");

const PLUGIN_ID = "context-port";
const PLUGIN_VERSION = "0.2.0";
const HOST = "openclaw";

function findLatestExport() {
  const directory = getExportDirectory();
  if (!fs.existsSync(directory)) return null;
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".contextport.json"))
    .map((name) => {
      const file = path.join(directory, name);
      return { file, modified: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.modified - a.modified);
  return files[0]?.file || null;
}

function removeOuterQuotes(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function resolveImportFile(argument) {
  const input = removeOuterQuotes(argument);
  if (!input || input.toLowerCase() === "latest") return findLatestExport();
  return path.resolve(input);
}

module.exports = {
  id: PLUGIN_ID,
  name: "ContextPort",
  description: "Export and restore portable context for OpenClaw",

  register(api) {
    api.on("before_prompt_build", (_event, ctx) => {
      const sessionId = String(ctx.sessionId || "unknown-session");
      const allowUntargeted = !ctx.trigger || ctx.trigger === "user";
      const pending = takePendingImport(HOST, sessionId, allowUntargeted);
      if (!pending) return undefined;

      const validation = pending.request?.bundle;
      if (!validation || validation.schema !== BUNDLE_SCHEMA) {
        api.logger.warn(`Ignored invalid ContextPort import ${pending.file}`);
        return undefined;
      }

      api.logger.info(
        `ContextPort imported ${validation.bundle_id || "unknown"} into ${sessionId}`
      );
      return { prependContext: buildImportedContext(validation) };
    });

    api.registerCommand({
      name: "context-export",
      description: "Export the current session into a portable bundle",
      acceptsArgs: false,
      requireAuth: true,

      handler: async (ctx) => {
        const selected = nativeHistory.resolveSession(
          String(ctx.sessionId || "unknown-session")
        );
        if (!selected) {
          return {
            text: "No transferable events were found for this session."
          };
        }
        const bundle = createBundle(HOST, PLUGIN_VERSION, selected.record);
        const outputFile = writeBundle(bundle);
        return {
          text: [
            "Conversation context exported.",
            `Event count: ${bundle.events.length}`,
            `File: ${outputFile}`,
            "",
            "You can now run: contextport import \"FILE\" --to openclaw"
          ].join("\n")
        };
      }
    });

    api.registerCommand({
      name: "context-import",
      description: "Import a portable bundle into the next agent turn",
      acceptsArgs: true,
      requireAuth: true,

      handler: async (ctx) => {
        if (!ctx.sessionKey) {
          return { text: "No session key is available in this OpenClaw session." };
        }
        const importFile = resolveImportFile(ctx.args);
        if (!importFile || !fs.existsSync(importFile)) {
          return {
            text: "No bundle was found. Pass a full path or use /context-import latest."
          };
        }

        let bundle;
        try {
          bundle = readBundle(importFile);
        } catch (error) {
          return { text: `Failed to import bundle: ${String(error.message || error)}` };
        }

        await api.session.workflow.enqueueNextTurnInjection({
          sessionKey: ctx.sessionKey,
          text: buildImportedContext(bundle),
          placement: "prepend_context",
          ttlMs: 30 * 60 * 1000,
          idempotencyKey:
            `${PLUGIN_ID}:` +
            shortHash(`${bundle.bundle_id}:${ctx.sessionId || "unknown"}`),
          metadata: {
            sourceHost: bundle.source?.host || "unknown",
            sourceSessionId: bundle.source?.session?.id || "unknown",
            bundleSchema: BUNDLE_SCHEMA
          }
        });

        return {
          text: [
            "Context is queued for the next turn in this session.",
            `Source file: ${importFile}`,
            "Now send a normal message to continue the imported task."
          ].join("\n"),
          continueAgent: false
        };
      }
    });

    api.logger.info(`ContextPort OpenClaw adapter ${PLUGIN_VERSION} registered`);
  }
};
