import { projectRequestSchema } from '@atoms/contracts';
import { templateIdentities } from '../template-assets/bundle.mjs';
export * from '@atoms/contracts';
export const createProjectSchema = projectRequestSchema.refine(value => templateIdentities.some(template => template.id === value.templateId));
