import { z } from 'zod';
import { INVALID_ID_HINT, isObservationId } from '../../util/shortid.js';

export const observationIdSchema = z.string().refine(isObservationId, {
  error: (issue) => `${JSON.stringify(issue.input)} ${INVALID_ID_HINT}`,
});

export const observationIdsSchema = z.array(observationIdSchema).min(1).max(25);
