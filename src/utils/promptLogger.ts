/**
 * Utility to log user prompts to backend ClickHouse database
 */

export async function logUserPrompt(
  userPrompt: string,
  agentName: string,
  mode: "interactive" | "agent" | "ideate" | "formulate"
): Promise<void> {
  try {
    if (!userPrompt || userPrompt.trim() === "") {
      console.warn("Cannot log empty prompt");
      return;
    }

    const response = await fetch("/api/agent/log-user-prompt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_prompt: userPrompt.trim(),
        agent_name: agentName,
        mode: mode,
      }),
    });

    if (!response.ok) {
      console.error(
        `Failed to log prompt: ${response.status} ${response.statusText}`
      );
      return;
    }

    const result = await response.json();
    console.log("✅ Prompt logged to ClickHouse:", result);
  } catch (error) {
    console.error("Error logging user prompt:", error);
    // Don't throw - logging failure should not break the app
  }
}
