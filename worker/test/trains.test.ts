import { describe, expect, it } from "vitest";
import { buildDepartures, serviceMessage, type LdbBoard, type LdbService } from "../src/trains/ldb";
import { mockBoard } from "../src/trains/mock";

const svc = (std: string, etd: string, dest: string, calls: string[] | null, extra: Partial<LdbService> = {}): LdbService => ({
  std,
  etd,
  destination: [{ locationName: dest, crs: dest.slice(0, 3).toUpperCase() }],
  subsequentCallingPoints: calls ? [{ callingPoint: calls.map((crs) => ({ crs, locationName: crs })) }] : null,
  ...extra,
});

const opts = (now: string) => ({
  filterCrs: "PTK",
  walkMinutes: 4,
  now: Number(now.slice(0, 2)) * 60 + Number(now.slice(3)),
});

describe("departures", () => {
  it("keeps trains towards Partick that are at least the walk time away", () => {
    const board: LdbBoard = {
      trainServices: [
        svc("06:46", "On time", "Milngavie", ["GLQ", "PTK"]), // 2 min away: too soon
        svc("06:50", "On time", "Springburn", ["BNH", "SPR"]), // wrong direction
        svc("06:56", "On time", "Milngavie", ["GLQ", "PTK"]),
        svc("07:26", "07:31", "Milngavie", ["GLQ", "PTK"]),
        svc("07:56", "Delayed", "Milngavie", ["GLQ", "PTK"]),
        svc("08:26", "On time", "Milngavie", ["GLQ", "PTK"]),
      ],
    };
    const rows = buildDepartures(board, opts("06:44"));
    expect(rows).toEqual([
      { scheduled: "06:56", status: "on-time", statusText: "ON TIME", leaveBy: "06:52", destination: "MILNGAVIE" },
      { scheduled: "07:26", status: "late", statusText: "EXP 07:31", leaveBy: "07:27", destination: "MILNGAVIE" },
      { scheduled: "07:56", status: "delayed", statusText: "DELAYED", leaveBy: "07:52", destination: "MILNGAVIE" },
    ]);
  });

  it("uses the expected time for the walk cut-off", () => {
    // Scheduled 2 min away but running 5 min late: still catchable.
    const board: LdbBoard = { trainServices: [svc("06:46", "06:51", "Milngavie", ["PTK"])] };
    expect(buildDepartures(board, opts("06:44"))[0]).toMatchObject({ statusText: "EXP 06:51", leaveBy: "06:47" });
  });

  it("shows cancellations without a leave-by time", () => {
    const board: LdbBoard = { trainServices: [svc("06:56", "Cancelled", "Milngavie", ["PTK"], { isCancelled: true })] };
    expect(buildDepartures(board, opts("06:44"))[0]).toMatchObject({ status: "cancelled", statusText: "CANCELLED", leaveBy: null });
  });

  it("trusts a board the API has already filtered", () => {
    const board: LdbBoard = { filtercrs: "PTK", trainServices: [svc("06:56", "On time", "Dalmuir", null)] };
    expect(buildDepartures(board, opts("06:44"))).toHaveLength(1);
  });

  it("drops services whose calling points show they miss Partick", () => {
    const board: LdbBoard = { trainServices: [svc("06:56", "On time", "Springburn", ["SPR"])] };
    expect(buildDepartures(board, opts("06:44"))).toHaveLength(0);
  });

  it("handles trains after midnight", () => {
    const board: LdbBoard = {
      trainServices: [svc("00:10", "On time", "Milngavie", ["PTK"]), svc("23:56", "On time", "Milngavie", ["PTK"])],
    };
    expect(buildDepartures(board, opts("23:50")).map((r) => r.scheduled)).toEqual(["23:56", "00:10"]);
  });

  it("turns service messages into plain text", () => {
    const board: LdbBoard = {
      nrccMessages: [{ Value: '<p>Disruption between A &amp; B. See <a href="x">Latest Travel News</a>.</p>' }],
    };
    expect(serviceMessage(board)).toBe("Disruption between A & B. See Latest Travel News.");
    expect(serviceMessage({ nrccMessages: null })).toBeNull();
    expect(serviceMessage({ nrccMessages: [{ value: "  " }] })).toBeNull();
  });
});

describe("mock boards", () => {
  const now = 6 * 60 + 44;
  const rows = (scenario: "normal" | "delayed" | "cancelled") =>
    buildDepartures(mockBoard(scenario, now, 4), { filterCrs: "PTK", walkMinutes: 4, now });

  it("normal: three on-time trains to Milngavie, no message", () => {
    expect(rows("normal").map((r) => [r.scheduled, r.statusText])).toEqual([
      ["06:56", "ON TIME"],
      ["07:26", "ON TIME"],
      ["07:56", "ON TIME"],
    ]);
    expect(serviceMessage(mockBoard("normal", now, 4))).toBeNull();
  });

  it("delayed: a late train, a delayed train and a message", () => {
    expect(rows("delayed").map((r) => r.statusText)).toEqual(["EXP 07:03", "DELAYED", "ON TIME"]);
    expect(serviceMessage(mockBoard("delayed", now, 4))).toMatch(/signalling fault/);
  });

  it("cancelled: first train cancelled with a message", () => {
    expect(rows("cancelled")[0]).toMatchObject({ status: "cancelled", leaveBy: null });
    expect(serviceMessage(mockBoard("cancelled", now, 4))).toMatch(/cancelled/);
  });
});
