#!/usr/bin/env node
/*
 * SessionStart launcher.
 *
 * Provisions the per-user token if needed (so the first prompt's QR is ready),
 * then shows the welcome greeting — NOT the QR. The QR rides on every prompt via
 * UserPromptSubmit → start-nudge.js. See launch.js for the shared provisioning.
 */
"use strict";

const path = require("path");

require("./launch.js").launch(path.join(__dirname, "welcome.js"));
