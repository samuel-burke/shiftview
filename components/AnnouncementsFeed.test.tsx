import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnouncementsFeed, { type Announcement } from "./AnnouncementsFeed";

const items: Announcement[] = [
  { id: 1, title: "Inventory Monday", body: "Store closed for inventory.", createdAt: "2026-06-15T12:00:00Z" },
  { id: 2, title: "New POS", body: "Training Thursday.", createdAt: "2026-06-14T12:00:00Z" },
];

describe("AnnouncementsFeed", () => {
  it("renders each announcement's title and body", () => {
    render(<AnnouncementsFeed announcements={items} />);
    expect(within(screen.getByTestId("announcement-1")).getByText("Inventory Monday")).toBeInTheDocument();
    expect(within(screen.getByTestId("announcement-1")).getByText(/Store closed/)).toBeInTheDocument();
  });

  it("shows an empty state with no announcements", () => {
    render(<AnnouncementsFeed announcements={[]} />);
    expect(screen.getByText(/no announcements/i)).toBeInTheDocument();
  });

  it("hides remove controls for non-managers", () => {
    render(<AnnouncementsFeed announcements={items} canManage={false} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete announcement/i })).not.toBeInTheDocument();
  });

  it("lets a manager delete an announcement", async () => {
    const onDelete = vi.fn();
    render(<AnnouncementsFeed announcements={items} canManage onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: /delete announcement new pos/i }));
    expect(onDelete).toHaveBeenCalledWith(2);
  });
});
