#!/usr/bin/env node
/*
 * Wallet command launcher (Claude UserPromptExpansion + Codex UserPromptSubmit).
 *
 * Provisions the per-user token if needed (idempotent; usually already done by the
 * SessionStart greeting / first nudge), exports the backend URL + token, then runs
 * the wallet brain. Shares launch.js with the QR hooks so token resolution and the
 * Codex-desktop skip are identical. See wallet.js for the render/emit contract.
 */
"use strict";

const path = require("path");

require("../qr/launch.js").launch(path.join(__dirname, "wallet.js"));
