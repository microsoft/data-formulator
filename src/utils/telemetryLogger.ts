export const logTelemetryEvent = async (
  eventName: string,
  payload: Record<string, unknown> = {},
): Promise<void> => {
  try {
    await fetch("/api/agent/log-telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_name: eventName,
        payload,
      }),
    });
  } catch (error) {
    // Telemetry should never break the user flow.
    console.warn("Telemetry failed:", error);
  }
};

