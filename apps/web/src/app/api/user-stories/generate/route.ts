import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createChatCompletion,
  getLLMProvider,
  getLLMModel,
  isLLMConfigured,
} from "@olly/core";
import { USER_STORIES_PROMPT } from "@olly/core/src/prompts/userStoriesPrompt";

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      description,
      selectedServices = [],
      storyCount = 5,
      includeAcceptanceCriteria = false,
    } = body;

    if (!description) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 }
      );
    }

    const provider = getLLMProvider()?.toLowerCase();
    const modelName = getLLMModel();

    if (!isLLMConfigured()) {
      return NextResponse.json(
        {
          error: `${provider} is selected as the LLM provider, but its API key is not configured.`,
        },
        { status: 500 }
      );
    }

    const prompt = `${USER_STORIES_PROMPT}

Generate ${storyCount} user stories for the following feature or product:

"${description}"

${
  selectedServices.length > 0
    ? `Context is being pulled from: ${selectedServices.join(", ")}`
    : ""
}

Generate exactly ${storyCount} user stories in the following JSON format. Each story must have:
- id: unique string
- title: short descriptive title
- description: "As a [user type], I want [goal], so that [benefit]"
- priority: one of "Critical", "High", "Medium", "Low"
- selected: true
${
  includeAcceptanceCriteria
    ? '- acceptanceCriteria: array of 3-5 acceptance criteria strings'
    : ""
}

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

    console.log(
      `[UserStories] Using provider: ${provider}, model: ${modelName}`
    );

    const completion = await createChatCompletion(
      [{ role: "user", content: prompt }],
      { model: modelName }
    );

    const jsonMatch = completion.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse generated stories");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({ stories: parsed.stories ?? [] });
  } catch (error: any) {
    console.error("[UserStories] Failed to generate:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate user stories" },
      { status: 500 }
    );
  }
}