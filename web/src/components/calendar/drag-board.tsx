"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FormError, FormState } from "@/lib/admin/form-state";

export type BoardAppointment = {
  id: string;
  name: string;
  statusLabel: string;
  /** Only a booked appointment can be dragged. */
  movable: boolean;
};

export type BoardSlot = {
  id: string;
  timeLabel: string;
  clinic: string;
  seatsLabel: string;
  /** Has a free seat and has not started: can take a drop or a new booking. */
  open: boolean;
  appointments: BoardAppointment[];
};

export type BoardDay = {
  date: string;
  label: string;
  slots: BoardSlot[];
};

/** Where the board's links lead: it serves the doctor dashboard and the facility portals. */
export type BoardPaths = {
  /** An appointment's page is `${appointments}/${id}`. */
  appointments: string;
  calendar: string;
  newBooking: string;
};

/** The server action that moves an appointment into a slot. */
export type MoveAction = (appointmentId: string, slotId: string) => Promise<FormState>;

const DRAG_TYPE = "text/x-appointment-id";
/** How long a finger must rest on an appointment before it lifts. */
const HOLD_MS = 350;
/** Moving further than this before the hold completes means the user is scrolling. */
const SCROLL_TOLERANCE_PX = 10;

type TouchDrag = { appointmentId: string; x: number; y: number; active: boolean };

/**
 * Week and day calendar. Drag a booked appointment onto an open slot to
 * reschedule it; the server applies the same rules as the reschedule form, in
 * one update.
 *
 * With a mouse this uses native drag and drop. On a touch screen, native drag
 * and drop does not exist, so a press-and-hold lifts the appointment and it
 * follows the finger; a quick swipe still scrolls the page.
 */
export function DragBoard({ days, paths, move }: { days: BoardDay[]; paths: BoardPaths; move: MoveAction }) {
  const t = useTranslations("doctor.calendar");
  const errors = useTranslations("admin.errors");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<FormError | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);

  const touch = useRef<TouchDrag | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  // While an appointment is lifted, the page must not scroll under the finger.
  // The listener has to be non-passive to be allowed to stop the scroll.
  useEffect(() => {
    const stopScroll = (event: TouchEvent) => {
      if (touch.current?.active) event.preventDefault();
    };
    document.addEventListener("touchmove", stopScroll, { passive: false });
    return () => document.removeEventListener("touchmove", stopScroll);
  }, []);

  function drop(slot: BoardSlot, appointmentId: string) {
    setTarget(null);
    if (!appointmentId || slot.appointments.some((appointment) => appointment.id === appointmentId)) return;
    // The patient is notified by SMS, so a stray drag must not move anything.
    if (!window.confirm(t("confirmMove", { time: slot.timeLabel }))) return;
    setError(null);
    startTransition(async () => {
      const result = await move(appointmentId, slot.id);
      if (result && "errors" in result) setError(result.errors[0] ?? "generic");
    });
  }

  function endTouch() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    touch.current = null;
    setLifted(null);
    setTarget(null);
  }

  function slotUnder(x: number, y: number): BoardSlot | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-slot-id]");
    const slotId = element?.dataset.slotId;
    if (!slotId) return null;
    for (const day of days) {
      const slot = day.slots.find((candidate) => candidate.id === slotId);
      if (slot) return slot.open ? slot : null;
    }
    return null;
  }

  const touchHandlers = (appointment: BoardAppointment) =>
    appointment.movable
      ? {
          onPointerDown: (event: React.PointerEvent) => {
            if (event.pointerType === "mouse") return;
            touch.current = { appointmentId: appointment.id, x: event.clientX, y: event.clientY, active: false };
            holdTimer.current = setTimeout(() => {
              if (!touch.current) return;
              touch.current.active = true;
              setLifted(appointment.id);
            }, HOLD_MS);
          },
          onPointerMove: (event: React.PointerEvent) => {
            const current = touch.current;
            if (!current) return;
            if (!current.active) {
              const moved = Math.hypot(event.clientX - current.x, event.clientY - current.y);
              if (moved > SCROLL_TOLERANCE_PX) endTouch();
              return;
            }
            setTarget(slotUnder(event.clientX, event.clientY)?.id ?? null);
          },
          onPointerUp: (event: React.PointerEvent) => {
            const current = touch.current;
            if (current?.active) {
              // The lift ends here; it must not also open the appointment.
              suppressClick.current = true;
              setTimeout(() => {
                suppressClick.current = false;
              }, 400);
              const slot = slotUnder(event.clientX, event.clientY);
              endTouch();
              if (slot) drop(slot, current.appointmentId);
              return;
            }
            endTouch();
          },
          onPointerCancel: endTouch,
          onContextMenu: (event: React.MouseEvent) => {
            // A long press would otherwise open the browser's link menu.
            if (touch.current) event.preventDefault();
          },
        }
      : {};

  return (
    <div className="flex flex-col gap-3" aria-busy={pending}>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {errors(error)}
        </p>
      )}
      <div
        className={`grid grid-cols-1 gap-3 ${days.length > 1 ? "md:grid-cols-7" : ""} ${pending ? "opacity-60" : ""}`}
      >
        {days.map((day) => (
          <section key={day.date} className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-semibold">
              <Link href={`${paths.calendar}?view=day&date=${day.date}`} className="underline">
                {day.label}
              </Link>
            </h2>
            {day.slots.length === 0 && <p className="text-xs text-zinc-500">{t("noSlots")}</p>}
            {day.slots.map((slot) => (
              <div
                key={slot.id}
                data-slot-id={slot.id}
                onDragOver={(event) => {
                  if (!slot.open) return;
                  event.preventDefault();
                  setTarget(slot.id);
                }}
                onDragLeave={() => setTarget((current) => (current === slot.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  if (slot.open) drop(slot, event.dataTransfer.getData(DRAG_TYPE));
                }}
                className={`flex flex-col gap-1 rounded border p-2 text-xs ${
                  target === slot.id
                    ? "border-blue-500 bg-blue-50"
                    : slot.open
                      ? "border-zinc-300"
                      : "border-zinc-200 bg-zinc-50"
                }`}
              >
                <span className="font-medium">{slot.timeLabel}</span>
                <span className="truncate text-zinc-600">{slot.clinic}</span>
                {slot.appointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={`${paths.appointments}/${appointment.id}`}
                    draggable={appointment.movable}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, appointment.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(event) => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        event.preventDefault();
                      }
                    }}
                    {...touchHandlers(appointment)}
                    className={`flex min-h-11 select-none flex-col justify-center rounded border px-2 py-1 [-webkit-touch-callout:none] ${
                      lifted === appointment.id
                        ? "border-blue-600 bg-blue-200 shadow-lg ring-2 ring-blue-500"
                        : "border-blue-300 bg-blue-50"
                    } ${appointment.movable ? "cursor-grab" : ""}`}
                  >
                    <span className="truncate font-medium">{appointment.name}</span>
                    <span className="text-zinc-600">{appointment.statusLabel}</span>
                  </Link>
                ))}
                {slot.open && (
                  <Link
                    href={`${paths.newBooking}?slot=${slot.id}`}
                    className="flex min-h-11 items-center text-zinc-600 underline"
                  >
                    {slot.seatsLabel} · {t("book")}
                  </Link>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
