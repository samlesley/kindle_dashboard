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
  leaveByMinutes: 5,
  now: Number(now.slice(0, 2)) * 60 + Number(now.slice(3)),
});

describe("departures", () => {
  it("keeps the next three trains towards Partick that haven't left", () => {
    const board: LdbBoard = {
      trainServices: [
        svc("06:40", "On time", "Milngavie", ["GLQ", "PTK"]), // already gone
        svc("06:46", "On time", "Milngavie", ["GLQ", "PTK"]), // 2 min away: still shown
        svc("06:50", "On time", "Springburn", ["BNH", "SPR"]), // wrong direction
        svc("06:56", "07:01", "Milngavie", ["GLQ", "PTK"]),
        svc("07:26", "Delayed", "Milngavie", ["GLQ", "PTK"]),
        svc("07:56", "On time", "Milngavie", ["GLQ", "PTK"]),
      ],
    };
    const rows = buildDepartures(board, opts("06:44"));
    expect(rows).toEqual([
      { scheduled: "06:46", status: "on-time", statusText: "ON TIME", leaveBy: "06:41", destination: "MILNGAVIE" },
      { scheduled: "06:56", status: "late", statusText: "EXP 07:01", leaveBy: "06:51", destination: "MILNGAVIE" },
      { scheduled: "07:26", status: "delayed", statusText: "DELAYED", leaveBy: "07:21", destination: "MILNGAVIE" },
    ]);
  });

  it("drops an on-time train the minute after its scheduled time", () => {
    const board: LdbBoard = { trainServices: [svc("06:44", "On time", "Milngavie", ["PTK"])] };
    expect(buildDepartures(board, opts("06:44"))).toHaveLength(1);
    expect(buildDepartures(board, opts("06:45"))).toHaveLength(0);
  });

  it("keeps a late train until after its expected time", () => {
    const board: LdbBoard = { trainServices: [svc("06:40", "06:47", "Milngavie", ["PTK"])] };
    expect(buildDepartures(board, opts("06:44"))[0]).toMatchObject({ statusText: "EXP 06:47", leaveBy: "06:35" });
    expect(buildDepartures(board, opts("06:47"))).toHaveLength(1);
    expect(buildDepartures(board, opts("06:48"))).toHaveLength(0);
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
    // Running late past midnight: kept until after its expected time.
    const late: LdbBoard = { trainServices: [svc("23:58", "00:03", "Milngavie", ["PTK"])] };
    expect(buildDepartures(late, opts("00:01"))).toHaveLength(1);
    expect(buildDepartures(late, opts("00:04"))).toHaveLength(0);
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
    buildDepartures(mockBoard(scenario, now), { filterCrs: "PTK", leaveByMinutes: 5, now });

  it("normal: three on-time trains to Milngavie, no message", () => {
    expect(rows("normal").map((r) => [r.scheduled, r.statusText])).toEqual([
      ["06:56", "ON TIME"],
      ["07:26", "ON TIME"],
      ["07:56", "ON TIME"],
    ]);
    expect(serviceMessage(mockBoard("normal", now))).toBeNull();
  });

  it("delayed: a late train, a delayed train and a message", () => {
    expect(rows("delayed").map((r) => r.statusText)).toEqual(["EXP 07:03", "DELAYED", "ON TIME"]);
    expect(serviceMessage(mockBoard("delayed", now))).toMatch(/signalling fault/);
  });

  it("cancelled: first train cancelled with a message", () => {
    expect(rows("cancelled")[0]).toMatchObject({ status: "cancelled", leaveBy: null });
    expect(serviceMessage(mockBoard("cancelled", now))).toMatch(/cancelled/);
  });
});
