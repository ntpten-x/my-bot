import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  automation: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
  configured: vi.fn(),
  validate: vi.fn(),
  path: vi.fn(),
}));

vi.mock("../../src/lib/guard", () => ({ authed: mocks.auth }));
vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    replyTemplate: {
      findUnique: mocks.find,
      update: mocks.update,
      deleteMany: mocks.deleteMany,
    },
    automationRule: {
      updateMany: mocks.automation,
    },
  },
}));
vi.mock("../../src/lib/supabase-storage", () => ({
  MESSAGE_IMAGE_MAX_BYTES: 2 * 1024 * 1024,
  messageImageStorageConfigured: mocks.configured,
  validateMessageImage: mocks.validate,
  messageImageObjectPath: mocks.path,
  uploadMessageImage: mocks.upload,
  removeMessageImage: mocks.remove,
  signedMessageImageUrl: mocks.signed,
}));

import { POST } from "../../src/app/api/templates/image/route";
import { DELETE, PATCH } from "../../src/app/api/templates/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({});
  mocks.configured.mockReturnValue(true);
  mocks.validate.mockReturnValue(null);
  mocks.path.mockReturnValue("templates/message-1/abc.jpg");
  mocks.upload.mockResolvedValue("templates/message-1/abc.jpg");
  mocks.signed.mockResolvedValue("https://signed.example/abc.jpg");
  mocks.find.mockResolvedValue({ id: "message-1", imagePath: "templates/message-1/old.jpg" });
  mocks.update.mockImplementation(async ({ data }) => ({ id: "message-1", name: "ร้าน", body: "สวัสดี", imagePath: data.imagePath ?? null }));
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.automation.mockResolvedValue({ count: 0 });
  mocks.remove.mockResolvedValue(undefined);
});

it("uploads a base64 image onto an existing message and replaces the old path", async () => {
  const tiny = Buffer.from("fake-jpeg").toString("base64");
  const response = await POST(new Request("http://localhost/api/templates/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "message-1", mime: "image/jpeg", dataBase64: tiny }),
  }));
  expect(response.status).toBe(200);
  expect(mocks.upload).toHaveBeenCalledWith("templates/message-1/abc.jpg", expect.any(Buffer), "image/jpeg");
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "message-1" }, data: { imagePath: "templates/message-1/abc.jpg" } });
  expect(mocks.remove).toHaveBeenCalledWith("templates/message-1/old.jpg");
  await expect(response.json()).resolves.toMatchObject({ template: { imagePath: "templates/message-1/abc.jpg", imageUrl: "https://signed.example/abc.jpg" } });
});

it("clears an image on patch and deletes storage on delete", async () => {
  const context = { params: Promise.resolve({ id: "message-1" }) };
  mocks.find.mockResolvedValue({ imagePath: "templates/message-1/old.jpg" });
  expect((await PATCH(new Request("http://localhost/api/templates/message-1", {
    method: "PATCH",
    body: JSON.stringify({ clearImage: true }),
  }), context)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "message-1" }, data: { imagePath: null } });
  expect(mocks.remove).toHaveBeenCalledWith("templates/message-1/old.jpg");

  mocks.find.mockResolvedValue({ imagePath: "templates/message-1/old.jpg" });
  expect((await DELETE(new Request("http://localhost/api/templates/message-1"), context)).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith("templates/message-1/old.jpg");
});
