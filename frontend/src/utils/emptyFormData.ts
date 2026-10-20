/**
 * A multipart form with no fields at all can't go to the backend as-is.
 *
 * The browser encodes an empty FormData as a lone closing boundary, which the
 * backend's multipart parser (python-multipart 0.0.6) rejects, so FastAPI
 * answers 400 "There was an error parsing the body" before the endpoint runs.
 * Forms built from optional inputs end up empty whenever the user fills none
 * of them - resolving a follow-up task with no notes, for one.
 *
 * services/api.ts sends such a request with no body instead. FastAPI then
 * reads every Form/File parameter as absent: optional ones get their default,
 * and a required one gets a 422 that names it.
 */
export function isEmptyFormData(data: unknown): boolean {
  if (typeof FormData === 'undefined' || !(data instanceof FormData)) return false;
  return data.keys().next().done === true;
}
