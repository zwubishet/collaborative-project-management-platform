import { gql } from 'apollo-server-express';

export  const typeDefs = gql`
  type User {
    id: Int!
    name: String!
    email: String!
    role: String!
  }

  type Workspace {
    id: Int!
    name: String!
    owner: User!
    members: [WorkspaceMember!]!
  }

  type WorkspaceMember {
    id: Int!
    role: String!
    user: User!
  }

  type AuthPayload {
    accessToken: String!
    user: User!
  }


  type Query {
    me: User
    myWorkspaces: [Workspace!]!
    workspace(id: Int!): Workspace
  }
  

  
  type Project {
  id: Int!
  name: String!
  workspace: Workspace!
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

  type Mutation {
    register(name: String!, email: String!, password: String!): User!
    login(email: String!, password: String!): AuthPayload!
    createWorkspace(name: String!): Workspace!
    addMember(workspaceId: Int!, userId: Int!, role: String!): WorkspaceMember!
    updateMemberRole(workspaceId: Int!, userId: Int!, role: String!): WorkspaceMember!
    removeMember(workspaceId: Int!, userId: Int!): Boolean!
  }

  extend type Query {
  workspaceProjects(workspaceId: Int!): [Project!]!
  project(projectId: Int!): Project
  task(taskId: Int!): Task
  notifications: [Notification!]!
  tasksByStatus(projectId: Int!, status: String!): [Task!]!
  myTasks: [Task!]!
}

extend type Mutation {
  createProject(workspaceId: Int!, name: String!): Project!
  addProjectMember(projectId: Int!, userId: Int!, role: String!): ProjectMembership!
  removeProjectMember(projectId: Int!, userId: Int!): Boolean!
  createTask(projectId: Int!, title: String!, description: String): Task!
  assignTask(taskId: Int!, userId: Int!): TaskAssignee!
  updateTaskStatus(taskId: Int!, status: String!): Task!
  addTask(input: AddTaskInput!): Task!
  markNotificationSeen(notificationId: Int!): Notification!
  unassignTask(taskId: Int!, userId: Int!): Boolean!
}

type Subscription {
  taskAdded: Task!
}

  input AddTaskInput {
  title: String!
  description: String
  projectId: Int!
}


`;
