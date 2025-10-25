import { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET!;

export const resolvers = {
  Query: {
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
        include: { owner: true, members: { include: { user: true } } },
      });
    },
    workspaceProjects: async (_parent: any, { workspaceId }: { workspaceId: number }, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");
  // check user is member of workspace
  const isMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: context.userId }
  });
  if (!isMember) throw new Error("Forbidden");

  return prisma.project.findMany({
    where: { workspaceId },
    include: { members: { include: { user: true } }, tasks: true }
  });
},

project: async (_parent: any, { projectId }: { projectId: number }, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { members: { include: { user: true } }, tasks: true }
  });
  if (!project) throw new Error("Project not found");

  // check if user is member of the project
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId, userId: context.userId }
  });
  if (!membership) throw new Error("Forbidden");

  return project;
},
notifications: async (_parent: any, _args: any, context: { userId: number | null }) => {
    if (!context.userId) throw new Error("Unauthorized");

    return prisma.notification.findMany({
      where: { recipientId: context.userId },
      orderBy: { createdAt: 'desc' }, // newest first
      include: { relatedTask: true }
    });
  },

   tasksByStatus: async (
    _parent: any,
    { projectId, status }: { projectId: number; status: string },
    context: { userId: number | null }
  ) => {
    if (!context.userId) throw new Error("Unauthorized");

    // Check user is a project member
    const membership = await prisma.projectMembership.findFirst({
      where: { projectId, userId: context.userId }
    });
    if (!membership) throw new Error("Forbidden");

    return prisma.task.findMany({
      where: { projectId, status },
      include: { assignees: { include: { user: true } }, notifications: true, project: true }
    });
  },

  myTasks: async (_parent: any, _args: any, context: { userId: number | null }) => {
    if (!context.userId) throw new Error("Unauthorized");

    return prisma.task.findMany({
      where: {
        assignees: { some: { userId: context.userId } }
      },
      include: { assignees: { include: { user: true } }, notifications: true, project: true },
      orderBy: { createdAt: 'desc' }
    });
  }
  },

  Mutation: {
    register: async (_parent: any, { name, email, password }: any) => {
      const hashed = await hash(password, 10);
      return prisma.user.create({ data: { name, email, password: hashed } });
    },

    login: async (_parent: any, { email, password }: any) => {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) throw new Error('User not found');

      const valid = await compare(password, user.password);
      if (!valid) throw new Error('Invalid password');

      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '15m' });
      return { accessToken, user };
    },

    createWorkspace: async (_parent: any, { name }: { name: string }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error('Unauthorized');
      return prisma.workspace.create({
        data: {
          name,
          ownerId: context.userId,
          members: { create: { userId: context.userId, role: 'OWNER' } },
        },
        include: { owner: true, members: { include: { user: true } } },
      });
    },

    addMember: async (_parent: any, { workspaceId, userId, role }: { workspaceId: number, userId: number, role: string }, context: { userId: number | null }) => {
      if (!context.userId) throw new Error('Unauthorized');
      const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new Error('Workspace not found');
      if (workspace.ownerId !== context.userId) throw new Error('Only owner can add members');

      return prisma.workspaceMember.create({ data: { workspaceId, userId, role }, include: { user: true } });
    },

    updateMemberRole: async (_parent: any, { workspaceId, userId, role }: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error('Unauthorized');
      const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new Error('Workspace not found');
      if (workspace.ownerId !== context.userId) throw new Error('Only owner can update member roles');

      const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
      if (!member) throw new Error('Member not found');

      return prisma.workspaceMember.update({ where: { id: member.id }, data: { role }, include: { user: true } });
    },

    removeMember: async (_parent: any, { workspaceId, userId }: any, context: { userId: number | null }) => {
      if (!context.userId) throw new Error('Unauthorized');
      const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!workspace) throw new Error('Workspace not found');
      if (workspace.ownerId !== context.userId) throw new Error('Only owner can remove members');

      const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
      if (!member) throw new Error('Member not found');

      await prisma.workspaceMember.delete({ where: { id: member.id } });
      return true;
    },

    createProject: async (_parent: any, { workspaceId, name }: { workspaceId: number, name: string }, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");

  // check if user is workspace owner
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found");
  if (workspace.ownerId !== context.userId) throw new Error("Only workspace owner can create projects");

  return prisma.project.create({
    data: { name, workspaceId },
    include: { members: true, tasks: true }
  });
},

addProjectMember: async (_parent: any, { projectId, userId, role }: any, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found");

  // Only workspace owner or project lead can add members
  const workspace = await prisma.workspace.findUnique({ where: { id: project.workspaceId } });
  if (workspace?.ownerId !== context.userId) throw new Error("Only owner can add project members");

  return prisma.projectMembership.create({
    data: { projectId, userId, role },
    include: { user: true }
  });
},

removeProjectMember: async (_parent: any, { projectId, userId }: any, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found");

  const workspace = await prisma.workspace.findUnique({ where: { id: project.workspaceId } });
  if (workspace?.ownerId !== context.userId) throw new Error("Only owner can remove project members");

  const member = await prisma.projectMembership.findFirst({ where: { projectId, userId } });
  if (!member) throw new Error("Member not found");

  await prisma.projectMembership.delete({ where: { id: member.id } });
  return true;
},
createTask: async (
    _parent: any,
    { projectId, title, description }: { projectId: number; title: string; description?: string },
    context: { userId: number | null }
  ) => {
    if (!context.userId) throw new Error("Unauthorized");

    // Check if user is a member of the project
    const membership = await prisma.projectMembership.findFirst({
      where: { projectId, userId: context.userId }
    });
    if (!membership) throw new Error("Forbidden");

    return prisma.task.create({
      data: { title, description, projectId },
      include: { assignees: { include: { user: true } }, notifications: true, project: true }
    });
  },

  task: async (_parent: any, { taskId }: { taskId: number }, context: { userId: number | null }) => {
  if (!context.userId) throw new Error("Unauthorized");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignees: { include: { user: true } }, notifications: true, project: true }
  });
  if (!task) throw new Error("Task not found");

  // Check if user is member of project
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: task.projectId, userId: context.userId }
  });
  if (!membership) throw new Error("Forbidden");

  return task;
},

  assignTask: async (
  _parent: any,
  { taskId, userId }: { taskId: number; userId: number },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });
  if (!task) throw new Error("Task not found");

  // Check if current user is project member
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: task.projectId, userId: context.userId }
  });
  if (!membership) throw new Error("Forbidden");

  const assignee = await prisma.taskAssignee.create({
    data: { taskId, userId },
    include: { user: true, task: true }
  });

  // Create notification for the assigned user
  await prisma.notification.create({
    data: {
      title: `New Task Assigned: ${task.title}`,
      body: `You have been assigned to task "${task.title}" in project "${task.project.name}"`,
      recipientId: userId,
      relatedTaskId: taskId
    }
  });

  return assignee;
},


  updateTaskStatus: async (
  _parent: any,
  { taskId, status }: { taskId: number; status: string },
  context: { userId: number | null }
) => {
  if (!context.userId) throw new Error("Unauthorized");

  const task = await prisma.task.findUnique({ 
    where: { id: taskId }, 
    include: { project: true, assignees: true } 
  });
  if (!task) throw new Error("Task not found");

  // Check if current user is project member
  const membership = await prisma.projectMembership.findFirst({
    where: { projectId: task.projectId, userId: context.userId }
  });
  if (!membership) throw new Error("Forbidden");

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: { status },
    include: { assignees: { include: { user: true } }, notifications: true, project: true }
  });

  // Notify all assignees except the one updating
  for (const assignee of task.assignees) {
    if (assignee.userId !== context.userId) {
      await prisma.notification.create({
        data: {
          title: `Task Updated: ${task.title}`,
          body: `The status of task "${task.title}" in project "${task.project.name}" is now "${status}"`,
          recipientId: assignee.userId,
          relatedTaskId: taskId
        }
      });
    }
  }

  return updatedTask;
},
 markNotificationSeen: async (_parent: any, { notificationId }: { notificationId: number }, context: { userId: number | null }) => {
    if (!context.userId) throw new Error("Unauthorized");

    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.recipientId !== context.userId) throw new Error("Notification not found or forbidden");

    return prisma.notification.update({
      where: { id: notificationId },
      data: { status: "SEEN" }
    });
  },

    unassignTask: async (
    _parent: any,
    { taskId, userId }: { taskId: number; userId: number },
    context: { userId: number | null }
  ) => {
    if (!context.userId) throw new Error("Unauthorized");

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true }
    });
    if (!task) throw new Error("Task not found");

    // Check if current user is project member
    const membership = await prisma.projectMembership.findFirst({
      where: { projectId: task.projectId, userId: context.userId }
    });
    if (!membership) throw new Error("Forbidden");

    // Check if the assignee exists
    const assignee = await prisma.taskAssignee.findFirst({
      where: { taskId, userId }
    });
    if (!assignee) throw new Error("Assignee not found");

    await prisma.taskAssignee.delete({ where: { id: assignee.id } });

    // Notify the removed user
    await prisma.notification.create({
      data: {
        title: `Task Unassigned: ${task.title}`,
        body: `You have been unassigned from task "${task.title}" in project "${task.project.name}"`,
        recipientId: userId,
        relatedTaskId: taskId
      }
    });

    return true;
  }

  },
};
