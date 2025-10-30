import { gql } from 'apollo-server-express';

export const typeDefs = gql`
 scalar ID
  type User {
    id: Int!
    name: String!
    email: String!
    role: String!
    createdAt: String!
  }
  type Query {
  users: [User!]!
  }


  type AuthPayload {
    accessToken: String!
    user: User!
  }

  type Workspace {
    id: Int!
    name: String!
    description: String
    owner: User!
    members: [WorkspaceMember!]!
    projects: [Project]
  }

  type WorkspaceMember {
    id: Int!
    role: String!
    user: User!
  }

  type Project {
    id: Int!
    name: String!
    description: String
    status: String!
    workspace: Workspace
    members: [ProjectMembership!]!
    tasks: [Task!]!
    createdAt: String!
    updatedAt: String!
  }

  type ProjectMembership {
    id: Int!
    role: String!
    user: User!
    project: Project!
  }

  type Task {
    id: Int!
    title: String!
    description: String
    status: String!
    priority: String!
    dueDate: String
    assignees: [TaskAssignee!]!
    notifications: [Notification!]!
    project: Project!
    createdAt: String!
    updatedAt: String!
  }

  type TaskAssignee {
    id: Int!
    task: Task!
    user: User!
  }

  type Notification {
    id: Int!
    title: String!
    body: String!
    status: String!
    relatedTask: Task
    createdAt: String!
    updatedAt: String!
  }

  type Query {
    me: User
    myWorkspaces: [Workspace!]!
    workspace(id: Int!): Workspace
    workspaceProjects(workspaceId: Int!): [Project!]!
    project(projectId: Int!): Project
    task(taskId: Int!): Task
    notifications: [Notification!]!
    tasksByStatus(projectId: Int!, status: String!): [Task!]!
    myTasks: [Task!]!
  }

  type Mutation {
    register(name: String!, email: String!, password: String!): AuthPayload!
    login(email: String!, password: String!): AuthPayload!
    sendResetPassword(email: String!): Boolean!
    resetPassword(token: String!, newPassword: String!): Boolean!
    logout: Boolean!
    refreshToken: AuthPayload!
    createWorkspace(name: String!, description: String): Workspace!
    addMember(workspaceId: Int!, userId: Int!, role: String!): WorkspaceMember!
    removeMember(workspaceId: Int!, userId: Int!): Boolean!
    updateMemberRole(workspaceId: Int!, userId: Int!, role: String!): WorkspaceMember!
    createProject(workspaceId: Int!, name: String!, description: String, status: String): Project!
    addProjectMember(projectId: Int!, userId: Int!, role: String!): ProjectMembership!
    removeProjectMember(projectId: Int!, userId: Int!): Boolean!
    addTask(input: AddTaskInput!): Task!
    updateTaskStatus(taskId: Int!, status: String!): Task!
    unassignTask(taskId: Int!, userId: Int!): Boolean!
    assignTaskMember(taskId: Int!, userId: Int!): Task!
    removeTaskMember(taskId: Int!, userId: Int!): Task!
    markNotificationSeen(notificationId: Int!): Notification!
  }

  type Subscription {
    taskAdded: Task!
  }


input AddTaskInput {
  projectId: Int!
  title: String!
  description: String
  status: String
  priority: String
  dueDate: String
  assigneeId: Int
}
`;