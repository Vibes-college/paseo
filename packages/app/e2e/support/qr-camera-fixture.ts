import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import QRCode from "qrcode";

export const QR_CAMERA_VIDEO_PATH = resolve(__dirname, "../../.dev/e2e-pairing-qr-camera.y4m");

const WIDTH = 400;
const HEIGHT = 400;
const FRAME_COUNT = 12;
const QUIET_ZONE_MODULES = 4;

function pairingOfferUrl(): string {
  const offer = {
    v: 2,
    serverId: "web-qr-camera-e2e",
    daemonPublicKeyB64: Buffer.alloc(32, 7).toString("base64"),
    relay: { endpoint: "127.0.0.1:1", useTls: false },
  };
  const encoded = Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
  return `https://app.paseo.sh/#offer=${encoded}`;
}

function createFrame(): Buffer {
  const qr = QRCode.create(pairingOfferUrl(), { errorCorrectionLevel: "M" });
  const moduleSpan = qr.modules.size + QUIET_ZONE_MODULES * 2;
  const scale = Math.floor(Math.min(WIDTH, HEIGHT) / moduleSpan);
  const renderedSize = moduleSpan * scale;
  const left = Math.floor((WIDTH - renderedSize) / 2);
  const top = Math.floor((HEIGHT - renderedSize) / 2);
  const yPlaneSize = WIDTH * HEIGHT;
  const frame = Buffer.alloc(yPlaneSize + yPlaneSize / 2, 128);
  frame.fill(235, 0, yPlaneSize);

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column) === 0) continue;
      const startX = left + (column + QUIET_ZONE_MODULES) * scale;
      const startY = top + (row + QUIET_ZONE_MODULES) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        frame.fill(16, y * WIDTH + startX, y * WIDTH + startX + scale);
      }
    }
  }

  return frame;
}

export async function writeQrCameraFixture(): Promise<void> {
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F1:1 Ip A1:1 C420jpeg\n`, "ascii");
  const frameHeader = Buffer.from("FRAME\n", "ascii");
  const frame = createFrame();
  const chunks: Buffer[] = [header];
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    chunks.push(frameHeader, frame);
  }
  await mkdir(dirname(QR_CAMERA_VIDEO_PATH), { recursive: true });
  await writeFile(QR_CAMERA_VIDEO_PATH, Buffer.concat(chunks));
}
