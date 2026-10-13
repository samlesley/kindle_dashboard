import type { DashboardModel } from "../dashboard";
import { drawDashboard } from "../layout";
import { encodeGreyscalePng } from "./png";
import { Font } from "./text";
import { TrueTypeFont } from "./ttf";

export function loadFont(data: ArrayBuffer | Uint8Array): Font {
  return new Font(new TrueTypeFont(data));
}

export function renderDashboardPng(font: Font, model: DashboardModel): Uint8Array<ArrayBuffer> {
  const canvas = drawDashboard(font, model);
  return encodeGreyscalePng(canvas.width, canvas.height, canvas.data);
}
