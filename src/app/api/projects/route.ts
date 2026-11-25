import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma, sanitizeProjectData } from "@/lib/prisma";

export async function GET() {
  try {
    const prisma = getPrisma();
    const projects = await prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ projects });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load projects.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      data?: unknown;
    };

    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : "Untitled Project";

    const cleanData = sanitizeProjectData(body.data);
    const prisma = getPrisma();

    const created = await prisma.project.create({
      data: {
        name,
        data: cleanData as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ project: created }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
