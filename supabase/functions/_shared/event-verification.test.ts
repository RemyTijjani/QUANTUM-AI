import {
  eventLocalDateKey,
  eventLocalDateKeys,
  mapInBatches,
} from "./event-verification.ts";

function assertEquals<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("eventLocalDateKey respects event timezone boundaries", () => {
  assertEquals(
    eventLocalDateKey("2026-03-08T04:59:59.999Z", "America/New_York"),
    "2026-03-07",
    "Timestamp before local midnight belongs to prior day",
  );
  assertEquals(
    eventLocalDateKey("2026-03-08T05:00:00.000Z", "America/New_York"),
    "2026-03-08",
    "Timestamp at local midnight belongs to new day",
  );
});

Deno.test("eventLocalDateKeys counts calendar days correctly across daylight-saving transition", () => {
  assertEquals(
    eventLocalDateKeys("2026-03-08T05:00:00.000Z", "2026-03-10T04:00:00.000Z", "America/New_York"),
    ["2026-03-08", "2026-03-09"],
    "Spring-forward transition should not skip or duplicate an event-local day",
  );
});

Deno.test("mapInBatches preserves item order across batches", async () => {
  const result = await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => value * 10);
  assertEquals(result, [10, 20, 30, 40, 50], "Mapped values should remain in input order");
});

Deno.test("mapInBatches rejects invalid batch sizes", async () => {
  let rejected = false;
  try {
    await mapInBatches([1], 33, async (value) => value);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true, "Batch sizes above the supported maximum should fail");
});
