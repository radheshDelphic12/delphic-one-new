import {
  Code2,
  Layout,
  Server,
  Database,
  Cloud,
  Smartphone,
  FlaskConical,
  BrainCircuit,
  Boxes,
} from 'lucide-react';

/** Category -> lucide icon component, used by SkillPicker chips/suggestions. */
export const CATEGORY_ICON = {
  language: Code2,
  frontend: Layout,
  backend: Server,
  database: Database,
  cloud_devops: Cloud,
  mobile: Smartphone,
  testing_qa: FlaskConical,
  data_ai: BrainCircuit,
  other: Boxes,
};

export const CATEGORY_LABEL = {
  language: 'Language',
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Database',
  cloud_devops: 'Cloud / DevOps',
  mobile: 'Mobile',
  testing_qa: 'Testing / QA',
  data_ai: 'Data / AI',
  other: 'Other',
};

/**
 * Curated skill/tech-stack pool for the searchable picker. Free text is
 * still accepted for anything not listed here — see SkillPicker.jsx.
 */
export const SKILLS_CATALOG = [
  // languages
  { id: 'javascript', label: 'JavaScript', category: 'language' },
  { id: 'typescript', label: 'TypeScript', category: 'language' },
  { id: 'python', label: 'Python', category: 'language' },
  { id: 'java', label: 'Java', category: 'language' },
  { id: 'csharp', label: 'C#', category: 'language' },
  { id: 'cpp', label: 'C++', category: 'language' },
  { id: 'c', label: 'C', category: 'language' },
  { id: 'go', label: 'Go', category: 'language' },
  { id: 'rust', label: 'Rust', category: 'language' },
  { id: 'ruby', label: 'Ruby', category: 'language' },
  { id: 'php', label: 'PHP', category: 'language' },
  { id: 'kotlin', label: 'Kotlin', category: 'language' },
  { id: 'swift', label: 'Swift', category: 'language' },
  { id: 'scala', label: 'Scala', category: 'language' },
  { id: 'perl', label: 'Perl', category: 'language' },
  { id: 'dart', label: 'Dart', category: 'language' },
  { id: 'r', label: 'R', category: 'language' },
  { id: 'sql', label: 'SQL', category: 'language' },
  { id: 'bash', label: 'Bash / Shell', category: 'language' },
  { id: 'powershell', label: 'PowerShell', category: 'language' },

  // frontend
  { id: 'react', label: 'React', category: 'frontend' },
  { id: 'nextjs', label: 'Next.js', category: 'frontend' },
  { id: 'vue', label: 'Vue.js', category: 'frontend' },
  { id: 'nuxt', label: 'Nuxt.js', category: 'frontend' },
  { id: 'angular', label: 'Angular', category: 'frontend' },
  { id: 'svelte', label: 'Svelte', category: 'frontend' },
  { id: 'redux', label: 'Redux', category: 'frontend' },
  { id: 'html', label: 'HTML', category: 'frontend' },
  { id: 'css', label: 'CSS', category: 'frontend' },
  { id: 'sass', label: 'Sass / SCSS', category: 'frontend' },
  { id: 'tailwind', label: 'Tailwind CSS', category: 'frontend' },
  { id: 'bootstrap', label: 'Bootstrap', category: 'frontend' },
  { id: 'jquery', label: 'jQuery', category: 'frontend' },
  { id: 'webpack', label: 'Webpack', category: 'frontend' },
  { id: 'vite', label: 'Vite', category: 'frontend' },

  // backend
  { id: 'nodejs', label: 'Node.js', category: 'backend' },
  { id: 'express', label: 'Express', category: 'backend' },
  { id: 'nestjs', label: 'NestJS', category: 'backend' },
  { id: 'django', label: 'Django', category: 'backend' },
  { id: 'flask', label: 'Flask', category: 'backend' },
  { id: 'fastapi', label: 'FastAPI', category: 'backend' },
  { id: 'spring', label: 'Spring / Spring Boot', category: 'backend' },
  { id: 'dotnet', label: '.NET / ASP.NET', category: 'backend' },
  { id: 'laravel', label: 'Laravel', category: 'backend' },
  { id: 'rails', label: 'Ruby on Rails', category: 'backend' },
  { id: 'graphql', label: 'GraphQL', category: 'backend' },
  { id: 'rest_api', label: 'REST APIs', category: 'backend' },
  { id: 'grpc', label: 'gRPC', category: 'backend' },
  { id: 'microservices', label: 'Microservices', category: 'backend' },

  // database
  { id: 'postgresql', label: 'PostgreSQL', category: 'database' },
  { id: 'mysql', label: 'MySQL', category: 'database' },
  { id: 'mongodb', label: 'MongoDB', category: 'database' },
  { id: 'redis', label: 'Redis', category: 'database' },
  { id: 'sqlite', label: 'SQLite', category: 'database' },
  { id: 'oracle_db', label: 'Oracle DB', category: 'database' },
  { id: 'mssql', label: 'SQL Server', category: 'database' },
  { id: 'elasticsearch', label: 'Elasticsearch', category: 'database' },
  { id: 'cassandra', label: 'Cassandra', category: 'database' },
  { id: 'dynamodb', label: 'DynamoDB', category: 'database' },
  { id: 'prisma', label: 'Prisma ORM', category: 'database' },

  // cloud / devops
  { id: 'aws', label: 'AWS', category: 'cloud_devops' },
  { id: 'azure', label: 'Azure', category: 'cloud_devops' },
  { id: 'gcp', label: 'Google Cloud (GCP)', category: 'cloud_devops' },
  { id: 'docker', label: 'Docker', category: 'cloud_devops' },
  { id: 'kubernetes', label: 'Kubernetes', category: 'cloud_devops' },
  { id: 'terraform', label: 'Terraform', category: 'cloud_devops' },
  { id: 'jenkins', label: 'Jenkins', category: 'cloud_devops' },
  { id: 'github_actions', label: 'GitHub Actions', category: 'cloud_devops' },
  { id: 'gitlab_ci', label: 'GitLab CI', category: 'cloud_devops' },
  { id: 'ansible', label: 'Ansible', category: 'cloud_devops' },
  { id: 'nginx', label: 'Nginx', category: 'cloud_devops' },
  { id: 'linux', label: 'Linux', category: 'cloud_devops' },

  // mobile
  { id: 'react_native', label: 'React Native', category: 'mobile' },
  { id: 'flutter', label: 'Flutter', category: 'mobile' },
  { id: 'android', label: 'Android (Native)', category: 'mobile' },
  { id: 'ios', label: 'iOS (Native)', category: 'mobile' },
  { id: 'ionic', label: 'Ionic', category: 'mobile' },

  // testing / QA
  { id: 'jest', label: 'Jest', category: 'testing_qa' },
  { id: 'cypress', label: 'Cypress', category: 'testing_qa' },
  { id: 'selenium', label: 'Selenium', category: 'testing_qa' },
  { id: 'playwright', label: 'Playwright', category: 'testing_qa' },
  { id: 'junit', label: 'JUnit', category: 'testing_qa' },
  { id: 'manual_testing', label: 'Manual Testing', category: 'testing_qa' },
  { id: 'automation_testing', label: 'Test Automation', category: 'testing_qa' },
  { id: 'performance_testing', label: 'Performance Testing', category: 'testing_qa' },

  // data / AI
  { id: 'machine_learning', label: 'Machine Learning', category: 'data_ai' },
  { id: 'deep_learning', label: 'Deep Learning', category: 'data_ai' },
  { id: 'pytorch', label: 'PyTorch', category: 'data_ai' },
  { id: 'tensorflow', label: 'TensorFlow', category: 'data_ai' },
  { id: 'pandas', label: 'Pandas', category: 'data_ai' },
  { id: 'numpy', label: 'NumPy', category: 'data_ai' },
  { id: 'data_engineering', label: 'Data Engineering', category: 'data_ai' },
  { id: 'spark', label: 'Apache Spark', category: 'data_ai' },
  { id: 'power_bi', label: 'Power BI', category: 'data_ai' },
  { id: 'tableau', label: 'Tableau', category: 'data_ai' },
  { id: 'llm', label: 'LLM / Generative AI', category: 'data_ai' },

  // other / practices
  { id: 'agile', label: 'Agile / Scrum', category: 'other' },
  { id: 'jira', label: 'Jira', category: 'other' },
  { id: 'git', label: 'Git', category: 'other' },
  { id: 'salesforce', label: 'Salesforce', category: 'other' },
  { id: 'sap', label: 'SAP', category: 'other' },
  { id: 'servicenow', label: 'ServiceNow', category: 'other' },
  { id: 'blockchain', label: 'Blockchain', category: 'other' },
  { id: 'cybersecurity', label: 'Cybersecurity', category: 'other' },
  { id: 'ui_ux_design', label: 'UI / UX Design', category: 'other' },
  { id: 'product_management', label: 'Product Management', category: 'other' },
];
