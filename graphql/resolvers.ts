import bcrypt, { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import nodemailer from "nodemailer"; 
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/token';

const ee = new EventEmitter();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET!;

export const resolvers = {
  Query: {
    users: async (_parent: any, _args: any, ctx: { prisma: { user: { findMany: () => any; }; }; }) => {
    return ctx.prisma.user.findMany();
  },

     me: async (_parent: any, _args: any, context: { userId: number | null }) => {
      if (!context.userId) return null;
      return prisma.user.findUnique({ where: { id: context.userId } });
    },

    myWorkspaces: async (_parent: any, _args: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error('Unauthorized');
      return prisma.workspace.findMany({
        where: { members: { some: { userId: context.userId } } },
        include: { owner: true, members: { include: { user: true } } },
      });
    },

workspace: async (_parent: any, { id }: { id: number }, context: { userId: number | null }) => {
  if (!context.userId) throw new Error('Unauthorized');
  return prisma.workspace.findUnique({
    where: { id },
    include: {
      owner: true,
      members: { include: { user: true } },
      projects: true,
      // Project: {
      //       select: { id: true, name: true },
      //     },
    },
  });
},


    workspaceProjects: async (_parent: any, { workspaceId }: { workspaceId: number }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const isMember = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: context.userId } });
      if (!isMember) throw new Error("Forbidden");

      return prisma.project.findMany({
        where: { workspaceId },
        include: { 
          members: { include: { user: true } }, tasks: true }
      });
    },

    project: async (_parent: any, { projectId }: { projectId: number }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { 
          workspace: true,
          members: { include: { user: true } }, tasks: true }
      });
      if (!project) throw new Error("Project not found");

      const membership = await prisma.workspaceMember.findFirst({
        where: { workspaceId: project.workspaceId, userId: context.userId }
      });
      if (!membership) throw new Error("Forbidden");

      return project;
    },

    notifications: async (_parent: any, _args: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      return prisma.notification.findMany({
        where: { recipientId: context.userId },
        orderBy: { createdAt: 'desc' },
        include: { relatedTask: true }
      });
    },

    task: async (_parent: any, { taskId }: { taskId: number }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { assignees: { include: { user: true } }, notifications: true, project: true }
      });
      if (!task) throw new Error("Task not found");

      const membership = await prisma.projectMembership.findFirst({
        where: { projectId: task.projectId, userId: context.userId }
      });
      if (!membership) throw new Error("Forbidden");

      return task;
    },

    tasksByStatus: async (_parent: any, { projectId, status }: { projectId: number; status: string }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const membership = await prisma.projectMembership.findFirst({ where: { projectId, userId: context.userId } });
      if (!membership) throw new Error("Forbidden");

      return prisma.task.findMany({
        where: { projectId, status },
        include: { assignees: { include: { user: true } }, notifications: true, project: true }
      });
    },

    myTasks: async (_parent: any, _args: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      return prisma.task.findMany({
        where: { assignees: { some: { userId: context.userId } } },
        include: { assignees: { include: { user: true } }, notifications: true, project: true },
        orderBy: { createdAt: 'desc' }
      });
    },
  },

  Mutation: {
     register: async (_parent: any, { name, email, password }: any) => {
      const hashed = await hash(password, 10);
      return prisma.user.create({ data: { name, email, password: hashed } });
    },

login: async (_parent: any, { email, password }: any, context: { res: any }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("User not found");

  const valid = await compare(password, user.password);
  if (!valid) throw new Error("Invalid password");

  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  const existingDevice = await prisma.userDevice.findUnique({
    where: { refreshToken },
  });
  if (existingDevice) {
    await prisma.userDevice.delete({ where: { id: existingDevice.id } });
  }

  await prisma.userDevice.create({
    data: {
      userId: user.id,
      refreshToken,
      ipAddress: context.res.req.ip,
      userAgent: context.res.req.headers["user-agent"],
    },
  });

  context.res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/", // ← Also fix path here (see below)
  });

  return { accessToken, user }; // ← Matches AuthPayload
},

 sendResetPassword: async (_: any, { email }: { email: string }) => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return false;

      // create a short-lived token for resetting password
      const token = jwt.sign(
        { userId: user.id },
        process.env.RESET_PASSWORD_SECRET!,
        { expiresIn: "1h" }
      );

      // send email with the reset link
      const transporter = nodemailer.createTransport({
        service: "Gmail", // or your SMTP server
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Reset your password",
        html: `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`,
      });

      return true;
    },

     resetPassword: async (_: any, { token, newPassword }: { token: string, newPassword: string }) => {
    try {
      const payload: any = jwt.verify(token, process.env.RESET_PASSWORD_SECRET!);
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: payload.userId },
        data: { password: hashedPassword },
      });

      return true;
    } catch (err) {
      console.error("Reset password error:", err);
      return false;
    }
  },

     logout: async (_parent: any, _args: any, context: { req: any; res: any }) => {
      const refreshToken = context.req.cookies.refreshToken;
      if (refreshToken) {
        await prisma.userDevice.updateMany({
          where: { refreshToken },
          data: { isRevoked: true },
        });
      }
      context.res.clearCookie("refreshToken", { path: "/auth/refresh" });
      return true;
    },

    refreshToken: async (_parent: any, _args: any, context: { req: any; res: any }) => {
      const refreshToken = context.req.cookies.refreshToken;
      if (!refreshToken) return null;

      const device = await prisma.userDevice.findUnique({ where: { refreshToken } });
      if (!device || device.isRevoked) return null;

      try {
        const payload: any = verifyRefreshToken(refreshToken);

        // Rotate refresh token
        await prisma.userDevice.updateMany({ where: { refreshToken }, data: { isRevoked: true } });
        const newAccessToken = generateAccessToken(payload.userId);
        const newRefreshToken = generateRefreshToken(payload.userId);

        await prisma.userDevice.create({
          data: {
            userId: payload.userId,
            refreshToken: newRefreshToken,
            ipAddress: context.req.ip,
            userAgent: context.req.headers["user-agent"],
          },
        });

        context.res.cookie("refreshToken", newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/auth/refresh",
        });

        return { accessToken: newAccessToken };
      } catch {
        return null;
      }
    },

   createWorkspace: async (
  _parent: any,
  args: { name: string; description?: string },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  const { name, description } = args;

  return prisma.workspace.create({
    data: {
      name,
      description,
      ownerId: context.userId,
      members: {
        create: { userId: context.userId, role: "OWNER" },
      },
    },
    include: {
      owner: true,
      members: { include: { user: true } },
    },
  });
},


addMember: async (
  _parent: any, 
  { workspaceId, userId, role }: { workspaceId: number; userId: number; role: string },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  // Fetch workspace
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found");

  // Only owner can add members
  if (workspace.ownerId !== context.userId) throw new Error("Only owner can add members");

  // Check if user is already a member
  const existingMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });
  if (existingMember) throw new Error("User is already a member");

  // Add member
  return prisma.workspaceMember.create({
    data: { workspaceId, userId, role },
    include: { user: true },
  });
},


updateMemberRole: async (
  _parent: any,
  { workspaceId, userId, role }: { workspaceId: number; userId: number; role: string },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found");

  if (workspace.ownerId !== context.userId) throw new Error("Only owner can update member roles");

  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) throw new Error("Member not found");

  return prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role },
    include: { user: true },
  });
},

removeMember: async (
  _parent: any,
  { workspaceId, userId }: { workspaceId: number; userId: number },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found");

  // Only owner can remove members
  if (workspace.ownerId !== context.userId) throw new Error("Only owner can remove members");

  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) throw new Error("Member not found");

  await prisma.workspaceMember.delete({ where: { id: member.id } });
  return true;
},

    createProject: async (_parent: any, {workspaceId, name, description, status } : any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new Error("Workspace not found");
      if (workspace.ownerId !== context.userId) throw new Error("Only workspace owner can create projects");

      return prisma.project.create({ data: { name, workspaceId, description, status}, include: { members: true, tasks: true } });
    },

    addProjectMember: async (_parent: any, { projectId, userId, role }: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("Project not found");
      const workspace = await prisma.workspace.findUnique({ where: { id: project.workspaceId } });
      if (!workspace || workspace.ownerId !== context.userId) throw new Error("Only owner can add project members");
      return prisma.projectMembership.create({ data: { projectId, userId, role }, include: { user: true } });
    },

    removeProjectMember: async (_parent: any, { projectId, userId }: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("Project not found");
      const workspace = await prisma.workspace.findUnique({ where: { id: project.workspaceId } });
      if (!workspace || workspace.ownerId !== context.userId) throw new Error("Only owner can remove project members");

      const member = await prisma.projectMembership.findFirst({ where: { projectId, userId } });
      if (!member) throw new Error("Member not found");
      await prisma.projectMembership.delete({ where: { id: member.id } });
      return true;
    },

    addTask: async (_parent: any, { input }: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");
      const project = await prisma.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new Error("Project not found");

      // const membership = await prisma.projectMembership.findFirst({ where: { projectId: input.projectId, userId: context.userId } });
      // if (!membership) throw new Error("Forbidden");
        let dueDate = input.dueDate;
        if (dueDate && !dueDate.includes("T")) {
          dueDate = new Date(dueDate).toISOString();
        }
      const newTask = await prisma.task.create({
        data: { title: input.title, description: input.description, priority: input.priority, dueDate: dueDate, status: input.status, project: { connect: { id: input.projectId } } },
        include: { project: true, assignees: { include: { user: true } }, notifications: true }
      });

      ee.emit("TASK_ADDED", newTask);
      return newTask;
    },

    updateTaskStatus: async (_parent: any, { taskId, status }: { taskId: number; status: string }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");

      const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true, assignees: true } });
      if (!task) throw new Error("Task not found");

      // const membership = await prisma.projectMembership.findFirst({ where: { projectId: task.projectId, userId: context.userId } });
      // if (!membership) throw new Error("Forbidden");

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: { status },
        include: { project: true, assignees: { include: { user: true } }, notifications: true }
      });

      for (const assignee of task.assignees) {
        if (assignee.userId !== context.userId) {
          await prisma.notification.create({
            data: {
              title: `Task Updated: ${task.title}`,
              body: `Status of "${task.title}" is now "${status}"`,
              recipientId: assignee.userId,
              relatedTaskId: taskId
            }
          });
        }
      }

      ee.emit("TASK_UPDATED", updatedTask);
      return updatedTask;
    },

    unassignTask: async (_parent: any, { taskId, userId }: { taskId: number; userId: number }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");

      const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
      if (!task) throw new Error("Task not found");

      // const membership = await prisma.projectMembership.findFirst({ where: { projectId: task.projectId, userId: context.userId } });
      // if (!membership) throw new Error("Forbidden");

      const assignee = await prisma.taskAssignee.findFirst({ where: { taskId, userId } });
      if (!assignee) throw new Error("Assignee not found");

      await prisma.taskAssignee.delete({ where: { id: assignee.id } });

      await prisma.notification.create({
        data: {
          title: `Task Unassigned: ${task.title}`,
          body: `You have been unassigned from task "${task.title}"`,
          recipientId: userId,
          relatedTaskId: taskId
        }
      });

      ee.emit("TASK_UNASSIGNED", { taskId, userId });
      return true;
    },

    assignTaskMember: async (_: any, { taskId, userId }: any, { prisma }: any) => {
  return await prisma.task.update({
  where: { id: taskId },
  data: {
    assignees: {
      create: { id: userId }
    }
  }
});

},

removeTaskMember: async (_: any, { taskId, userId }: any, { prisma }: any) => {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      assignees: { disconnect: { id: userId } },
    },
    include: { assignees: true },
  });
},


    markNotificationSeen: async (_parent: any, { notificationId }: { notificationId: number }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error("Unauthorized");

      const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
      if (!notification || notification.recipientId !== context.userId) throw new Error("Notification not found or forbidden");

      return prisma.notification.update({ where: { id: notificationId }, data: { status: "SEEN" } });
    },
  },

Subscription: {
  taskAdded: {
    subscribe: async function* () {
      while (true) {
        yield await new Promise(resolve =>
          ee.once('TASK_ADDED', async (task: any) => {
            const fullTask = await prisma.task.findUnique({
              where: { id: task.id },
              include: {
                project: true,
                assignees: { include: { user: true } },
                notifications: true
              }
            });
            resolve({ taskAdded: fullTask });
          })
        );
      }
    }
  }
}
};
