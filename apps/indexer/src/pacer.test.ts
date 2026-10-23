import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { describe, test } from "node:test";

import { describeError } from "./pacer.ts";

/** What `AbortSignal.timeout` aborts with. */
const TIMEOUT = new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("a failed request's reason", () => {
	test("reads the same for a timeout through node:https as through fetch", async () => {
		// fetch rejects with the signal's reason; node:https with an AbortError that it causes.
		const aborted: unknown = await once(new EventEmitter(), "never", {
			signal: AbortSignal.abort(TIMEOUT),
		}).catch((error: unknown) => error);
		assert.equal(describeError(aborted), describeError(TIMEOUT));
		assert.match(describeError(aborted), /timeout/);
	});

	test("names the network error's code once, wherever the error keeps it", () => {
		const hangUp = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
		const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
		assert.equal(
			describeError(new TypeError("fetch failed", { cause: hangUp })),
			"fetch failed (ECONNRESET)"
		);
		assert.equal(describeError(hangUp), "socket hang up (ECONNRESET)");
		assert.equal(describeError(reset), "read ECONNRESET");
	});
});
