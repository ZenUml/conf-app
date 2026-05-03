export const PRE_DEFINED_PROMPTS = [
  {
    title: 'Write a Job Description for a Java developer',
    prompt: `Create a job description for a Full Stack Developer with the following requirements:
- 3+ years of experience in web development
- Proficiency in HTML, CSS, JavaScript, and Python
- Familiarity with front-end frameworks such as React or Angular
- Experience with back-end technologies like Django or Node.js
- Strong problem-solving and communication skills`,
  },
  {
    title: 'Create an OpenAPI spec for a REST API',
    prompt: `Design an OpenAPI schema for a simple task management API with the following endpoints:
- GET /tasks: Retrieve a list of tasks
- POST /tasks: Create a new task
- GET /tasks/{id}: Retrieve a specific task by ID
- PUT /tasks/{id}: Update a task by ID
- DELETE /tasks/{id}: Delete a task by ID

The Task model should have the following fields:
- id: A unique identifier
- title: A short description of the task
- completed: A boolean indicating if the task is completed`,
  },
  {
    title: 'Compare Azure and GCP',
    prompt: `Compare Azure Functions and Google Cloud Functions in terms of the following aspects:
- Pricing
- Performance
- Scalability
- Deployment options
- Supported programming languages
Please create a table.`,
  },
];
