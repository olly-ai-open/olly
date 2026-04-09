import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { description, selectedServices, storyCount, includeAcceptanceCriteria } = body;

    if (!description) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const prompt = `You are an expert product manager. Generate ${storyCount} user stories for the following feature or product:

"${description}"

${selectedServices.length > 0 ? `Context is being pulled from: ${selectedServices.join(", ")}` : ""}

Generate exactly ${storyCount} user stories in the following JSON format. Each story must have:
- id: unique string
- title: short descriptive title
- description: "As a [user type], I want [goal], so that [benefit]"
- priority: one of "Critical", "High", "Medium", "Low"
- selected: true
${includeAcceptanceCriteria ? '- acceptanceCriteria: array of 3-5 acceptance criteria strings' : ''}

Return ONLY a valid JSON object with a "stories" array. No other text.

Example format:
{
  "stories": [
    {
      "id": "story-1",
      "title": "User login with email",
      "description": "As a registered user, I want to log in with my email and password, so that I can access my personalized dashboard.",
      "priority": "High",
      "selected": true
    }
  ]
}`;

    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { generateText } = await import("ai");

    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse generated stories");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ stories: parsed.stories });
  } catch (error: any) {
    console.error("Failed to generate user stories:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate user stories" },
      { status: 500 }
    );
  }
}
