#!/usr/bin/env node
/*
 * UserPromptSubmit launcher.
 *
 * On every prompt, provisions the per-user token if needed (idempotent; the
 * SessionStart greeting usually did it already), then renders the QR nudge. See
 * launch.js for the shared provisioning, and nudge.js for the per-prompt cache
 * that keeps the backend off the critical path of each prompt.
 */
"use strict";

const path = require("path");

require("./launch.js").launch(path.join(__dirname, "nudge.js"));
