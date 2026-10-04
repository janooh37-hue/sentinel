import { serviceHref } from '@/lib/quickActions'

/** Where "New record" leads: the service picker, or straight to the Inmate
 *  Conduct Violations form for inmate reporters. */
export function newRecordHref(isInmateReporter: boolean): string {
  return isInmateReporter ? serviceHref('Inmate Conduct Violations') : '/services'
}
