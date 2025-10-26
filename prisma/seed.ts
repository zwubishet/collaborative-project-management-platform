import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function seed() {
  console.log("Seeding database...");

  // Delete existing data (optional, for clean test)
  await prisma.taskAssignee.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.projectMembership.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.workspaceMember.deleteMany({});
  await prisma.workspace.deleteMany({});
  await prisma.user.deleteMany({});

  // Create a test user
  const user = await prisma.user.create({
    data: {
      name: "Test User",
      email: "test@example.com",
      password: await hash("password123", 10),
      role: "USER",
    },
  });

  // Create workspace
  const workspace = await prisma.workspace.create({
    data: {
      name: "Test Workspace",
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  // Create project
  const project = await prisma.project.create({
    data: { name: "Test Project", workspaceId: workspace.id },
  });

  // Add membership
  await prisma.projectMembership.create({
    data: { projectId: project.id, userId: user.id, role: "MEMBER" },
  });

  console.log("✅ Seed complete!");
}

seed()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
