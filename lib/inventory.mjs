import { Temporal } from "@js-temporal/polyfill";
import assert from "node:assert/strict";
import {
  execFileSync,
  spawn,
} from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import winston from "winston";

const defaultLogger = winston.createLogger({
  level: "warn",
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
  transports: new winston.transports.Console({
    stderrLevels: ["debug", "warn", "info"],
  }),
});

/**
 * @typedef {Object} InventoryOptions
 * @property {string} [repo] - GitHub repository in the format "owner/repo"
 * @property {string} [destPath] - Destination path for cloning the repository
 * @property {winston.Logger} [logger] - Winston logger instance
 */

/**
 * @typedef {Object} InventoryMetadata
 * @property {string} commit - Full commit hash
 * @property {string} commitShort - Short commit hash
 * @property {string} authorDate - ISO 8601 date string of commit author date
 */

export class Inventory {
  /**
   * @param {InventoryOptions} [opts]
   */
  constructor(opts) {
    const defaults = {
      repo: "mdn/content",
      destPath: relative(process.cwd(), ".mdn-content"), // TODO: use tempdir by default
      logger: defaultLogger,
    };
    const resolvedOpts = { ...defaults, ...opts };

    /** @type {string} */
    this.repo = resolvedOpts.repo;
    /** @type {string} */
    this.destPath = resolvedOpts.destPath;
    /** @type {winston.Logger} */
    this.logger = resolvedOpts.logger;

    /** @type {string} */
    this.rawInventoryStdErr = "";
    /** @type {string} */
    this.rawInventoryStdOut = "";
    /** @type {string | undefined} */
    this.rawRedirects = undefined;
  }

  /**
   * Initialize the inventory by cloning, checking out, and loading data
   * @param {string} ref - Git reference (commit, branch, or tag)
   * @param {string} [date] - Optional date string to find commit at specific time
   * @returns {Promise<void>}
   */
  async init(ref, date) {
    this.clone();
    this.checkout(ref, date);
    this.loadRedirects();
    this.installDeps();
    const result = await this.loadInventory();
    if (result === null || result > 0) {
      this.logger.error(this.rawInventoryStdErr);
      throw new Error("Failed to load data. See stdout above for details.");
    }
  }

  /**
   * Clone the repository if it doesn't exist
   * @returns {void}
   */
  clone() {
    if (
      !existsSync(this.destPath) ||
      !existsSync(join(this.destPath, "/.git"))
    ) {
      this.logger.info(`Cloning ${this.repo} to ${this.destPath}`);
      execFileSync("gh", [
        "repo",
        "clone",
        this.repo,
        this.destPath,
        "--",
        "--filter=blob:none",
        "--quiet",
      ]);
    } else {
      this.logger.info(`Reusing existing clone at ${this.destPath}`);
    }
  }

  /**
   * Checkout a specific git reference
   * @param {string} ref - Git reference (commit, branch, or tag)
   * @param {string} [date] - Optional date string to find commit at specific time
   * @returns {void}
   */
  checkout(ref, date) {
    this.logger.debug(`Fetching from origin`);
    execFileSync("git", ["fetch", "origin"], { cwd: this.destPath });
    if (date) {
      const target = Temporal.PlainDate.from(date)
        .toZonedDateTime({ timeZone: "UTC", plainTime: "00:00:01" })
        .startOfDay();
      this.logger.info(`Looking for commit on ${ref} at ${target.toString()}`);
      const hash = execFileSync(
        "git",
        ["rev-list", "-1", `--before=${target.toString()}`, ref],
        { cwd: this.destPath, encoding: "utf-8" },
      )
        .split("\n")
        .filter((line) => line.length > 0)
        .at(-1);
      if (!hash) {
        throw new Error(`Could not find commit near to ${target.toString()}`);
      }
      ref = hash;
    }

    this.logger.info(`Checking out ${ref}`);
    execFileSync("git", ["switch", "--quiet", "--detach", ref], {
      cwd: this.destPath,
      encoding: "utf-8",
    });
  }

  /**
   * Install npm dependencies in the cloned repository
   * @returns {void}
   */
  installDeps() {
    this.logger.info("Installing dependencies…");
    execFileSync("npm", ["ci"], {
      cwd: this.destPath,
      encoding: "utf-8",
      stdio: "ignore",
      env: { ...process.env, CI: "true" },
    });
  }

  /**
   * Load the inventory data by running the content inventory command
   * @returns {Promise<number | null>}
   */
  loadInventory() {
    const process = spawn(
      "npm",
      ["--silent", "run", "content", "--", "inventory", "--quiet"],
      { cwd: this.destPath },
    );

    process.stdout.setEncoding("utf-8");
    process.stderr.setEncoding("utf-8");
    process.stdout.on("data", (/** @type {string} */ chunk) => {
      this.rawInventoryStdOut = this.rawInventoryStdOut + chunk;
    });
    process.stderr.on("data", (/** @type {string} */ chunk) => {
      this.rawInventoryStdErr = this.rawInventoryStdErr + chunk;
    });

    return new Promise((resolve, reject) => {
      process.on("error", (err) => {
        reject(err);
      });

      process.on("close", (code) => {
        resolve(code);
      });
    });
  }

  /**
   * Load redirects from the repository
   * @returns {void}
   */
  loadRedirects() {
    this.rawRedirects = readFileSync(
      `${this.destPath}/files/en-us/_redirects.txt`,
      "utf8",
    );
  }

  /**
   * Get metadata about the checked out commit
   * @returns {InventoryMetadata}
   */
  metadata() {
    /** @type {import("node:child_process").ExecFileSyncOptionsWithStringEncoding} */
    const readOpts = {
      cwd: this.destPath,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    };

    const commitShort = execFileSync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      readOpts,
    )
      .split("\n")
      .filter((line) => line.length > 0)
      .at(-1);
    assert(commitShort?.length);

    const commit = execFileSync("git", ["rev-parse", "HEAD"], readOpts)
      .split("\n")
      .filter((line) => line.length > 0)
      .at(-1);
    assert(commit?.length);

    const authorInstant = execFileSync(
      "git",
      ["show", "--no-patch", "--format=%aI"],
      readOpts,
    )
      .split("\n")
      .filter((line) => line.length > 0)
      .at(-1);
    assert(authorInstant?.length);
    const authorDate = Temporal.Instant.from(authorInstant)
      .toZonedDateTimeISO("UTC")
      .toString();

    return { commit, commitShort, authorDate };
  }

  /**
   * Get the parsed inventory data
   * @returns {any}
   */
  inventory() {
    return JSON.parse(this.rawInventoryStdOut);
  }

  /**
   * Get the redirects map
   * @returns {Record<string, string>}
   */
  redirects() {
    if (this.rawRedirects === undefined) {
      throw new Error(
        "Redirects haven't been loaded. Did you call `init()` or `loadRedirects()` first?",
      );
    }

    const lines = this.rawRedirects.split("\n");
    const redirectLines = lines.filter(
      (line) => line.startsWith("/") && line.includes("\t"),
    );
    /** @type {Map<string, string>} */
    const redirectMap = new Map();
    for (const redirectLine of redirectLines) {
      const [source, target] = redirectLine.split("\t", 2);
      if (source && target) {
        redirectMap.set(source, target);
      }
    }
    return Object.fromEntries(redirectMap);
  }

  /**
   * Convert the inventory to a plain object
   * @returns {{ metadata: InventoryMetadata, inventory: any, redirects: Record<string, string> }}
   */
  toObject() {
    return {
      metadata: this.metadata(),
      inventory: this.inventory(),
      redirects: this.redirects(),
    };
  }

  /**
   * Clean up the cloned repository
   * @returns {void}
   */
  cleanUp() {
    this.logger.info("Cleaning up…");
    rmSync(this.destPath, { recursive: true, force: true });
  }
}
