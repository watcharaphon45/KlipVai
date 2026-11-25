import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma, sanitizeProjectData } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const prisma = getPrisma();
    const project = await prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ project });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: unknown;
      data?: unknown;
    };

    const prisma = getPrisma();
    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : existing.name;

    const cleanData = sanitizeProjectData(body.data);

    const updated = await prisma.project.update({
      where: { id },
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

    return NextResponse.json({ project: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const prisma = getPrisma();
    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Project not found." },
        { status: 404 }
      );
    }

    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ deletedId: id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete project.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
