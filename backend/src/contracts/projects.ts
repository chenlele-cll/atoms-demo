import { projectRequestSchema } from '@atoms/contracts';
import { companyTemplateIdentity } from '../template-assets/bundle.mjs';
import { z } from 'zod';
export * from '@atoms/contracts';
export const createProjectSchema = projectRequestSchema.extend({ templateId: z.literal(companyTemplateIdentity.id) });
