// Sample departure boards in the same JSON shape as the live API, so the
// mock goes through exactly the same parsing and filtering as live data.
// Times are generated around "now" so the board always looks current.

import type { MockScenario } from "../config";
import { formatMinutes, minutesUntil, parseHhmm } from "../time";
import type { LdbBoard, LdbCallingPoint, LdbService } from "./ldb";

const WEST: LdbCallingPoint[] = [
  { locationName: "Glasgow Queen Street", crs: "GLQ" },
  { locationName: "Charing Cross (Glasgow)", crs: "CHC" },
  { locationName: "Partick", crs: "PTK" },
  { locationName: "Hyndland", crs: "HYN" },
  { locationName: "Westerton", crs: "WES" },
  { locationName: "Bearsden", crs: "BEA" },
  { locationName: "Hillfoot", crs: "HLF" },
  { locationName: "Milngavie", crs: "MLN" },
];

const EAST: LdbCallingPoint[] = [
  { locationName: "Barnhill", crs: "BNH" },
  { locationName: "Springburn", crs: "SPR" },
];

function service(std: number, westbound: boolean, n: number): LdbService {
  const points = westbound ? WEST : EAST;
  const last = points[points.length - 1];
  return {
    std: formatMinutes(std),
    etd: "On time",
    platform: westbound ? "1" : "2",
    operator: "ScotRail",
    isCancelled: false,
    origin: [westbound ? { locationName: "Springburn", crs: "SPR" } : { locationName: "Milngavie", crs: "MLN" }],
    destination: [{ locationName: last.locationName, crs: last.crs }],
    subsequentCallingPoints: [{ callingPoint: points.map((p, i) => ({ ...p, st: formatMinutes(std + 3 + i * 3), et: "On time" })) }],
    serviceID: `MOCK${n}`,
  };
}

/**
 * Half-hourly each way, all day: towards Milngavie (via Queen St and
 * Partick) at :26 and :56, towards Springburn at :11 and :41.
 * The scenario changes the first trains towards Partick that are at least
 * `leadMinutes` away, i.e. the ones that will be shown.
 */
export function mockBoard(scenario: MockScenario, now: number, leadMinutes: number): LdbBoard {
  const services: LdbService[] = [];
  const start = now - 10;
  for (let t = start; t <= now + 120; t++) {
    const m = ((t % 60) + 60) % 60;
    if (m === 26 || m === 56) services.push(service(t, true, services.length));
    if (m === 11 || m === 41) services.push(service(t, false, services.length));
  }

  const shown = services.filter((s) => s.destination?.[0]?.crs === "MLN" && minutesUntil(parseHhmm(s.std)!, now) >= leadMinutes);
  const board: LdbBoard = {
    generatedAt: new Date().toISOString(),
    locationName: "Alexandra Parade",
    crs: "AXP",
    trainServices: services,
    nrccMessages: null,
  };

  if (scenario === "delayed" && shown.length >= 2) {
    const first = shown[0];
    first.etd = formatMinutes(parseHhmm(first.std)! + 7);
    first.delayReason = "This train has been delayed by a signalling fault";
    shown[1].etd = "Delayed";
    board.nrccMessages = [
      {
        Value:
          "<p>Trains between Glasgow Queen Street and Partick may be delayed by up to 15 minutes because of a signalling fault at Charing Cross.</p>",
      },
    ];
  }

  if (scenario === "cancelled" && shown.length >= 1) {
    const first = shown[0];
    first.etd = "Cancelled";
    first.isCancelled = true;
    first.cancelReason = "This train has been cancelled because of a shortage of train crew";
    board.nrccMessages = [
      {
        Value:
          '<p>Disruption between Springburn and Milngavie. Some trains are being cancelled. More details can be found in <a href="https://www.nationalrail.co.uk/">Latest Travel News</a>.</p>',
      },
    ];
  }

  return board;
}
