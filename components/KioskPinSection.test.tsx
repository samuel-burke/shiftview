import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import KioskPinSection from "./KioskPinSection";

let calls: { url: string; method: string; body: any }[] = [];

function mockFetch(answers: Record<string, { status: number; body: unknown }>) {
  calls = [];
  vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: input.toString(), method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const a = answers[method] ?? { status: 200, body: {} };
    return { ok: a.status < 400, status: a.status, json: async () => a.body } as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("KioskPinSection", () => {
  it("shows whether the employee has a PIN, for the employee named", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: true } } });
    render(<KioskPinSection employeeId={11} />);
    expect(await screen.findByText("Set")).toBeInTheDocument();
    expect(calls[0].url).toBe("/api/kiosk/pin?employeeId=11");
  });

  it("refuses an easy PIN before sending it", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: false } } });
    render(<KioskPinSection />);
    await screen.findByText("Not set");
    fireEvent.change(screen.getByLabelText("New kiosk PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/too easy/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("keeps only digits, at most 6", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: false } } });
    render(<KioskPinSection />);
    const input = screen.getByLabelText("New kiosk PIN") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "48a2-1390" } });
    expect(input.value).toBe("482139");
  });

  it("saves a PIN and clears the field", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: false } }, PUT: { status: 200, body: { ok: true } } });
    render(<KioskPinSection employeeId={11} />);
    await screen.findByText("Not set");
    fireEvent.change(screen.getByLabelText("New kiosk PIN"), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("PIN saved")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ employeeId: 11, pin: "4821" });
    expect((screen.getByLabelText("New kiosk PIN") as HTMLInputElement).value).toBe("");
  });

  it("shows the server's refusal (a taken PIN)", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: false } }, PUT: { status: 409, body: { error: "That PIN is taken — choose another" } } });
    render(<KioskPinSection />);
    fireEvent.change(screen.getByLabelText("New kiosk PIN"), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That PIN is taken — choose another")).toBeInTheDocument();
  });

  it("shows a generated PIN once", async () => {
    mockFetch({ GET: { status: 200, body: { hasPin: false } }, POST: { status: 201, body: { pin: "731690" } } });
    render(<KioskPinSection />);
    fireEvent.click(screen.getByRole("button", { name: "Generate a PIN" }));
    await waitFor(() => expect(screen.getByTestId("generated-pin")).toHaveTextContent("731690"));
    expect(screen.getByText("Set")).toBeInTheDocument();
  });
});
