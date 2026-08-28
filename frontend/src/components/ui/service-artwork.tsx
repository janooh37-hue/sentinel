import acknowledgmentArtwork from '@/assets/service-icons/acknowledgment.webp'
import administrativeLeaveArtwork from '@/assets/service-icons/administrative-leave.webp'
import dutyLocationsArtwork from '@/assets/service-icons/duty-locations.webp'
import dutyResumptionArtwork from '@/assets/service-icons/duty-resumption.webp'
import employeeAbsenceArtwork from '@/assets/service-icons/employee-absence.webp'
import employeeClearanceArtwork from '@/assets/service-icons/employee-clearance.webp'
import generalBookArtwork from '@/assets/service-icons/general-book.webp'
import hrRequestArtwork from '@/assets/service-icons/hr-request.webp'
import inmateConductArtwork from '@/assets/service-icons/inmate-conduct.webp'
import leaveApplicationArtwork from '@/assets/service-icons/leave-application.webp'
import leavePermitArtwork from '@/assets/service-icons/leave-permit.webp'
import materialRequestArtwork from '@/assets/service-icons/material-request.webp'
import nationalServiceArtwork from '@/assets/service-icons/national-service.webp'
import passportReleaseArtwork from '@/assets/service-icons/passport-release.webp'
import passportReleaseListArtwork from '@/assets/service-icons/passport-release-list.webp'
import reportArtwork from '@/assets/service-icons/report.webp'
import resignationLetterArtwork from '@/assets/service-icons/resignation-letter.webp'
import salaryDeductionArtwork from '@/assets/service-icons/salary-deduction.webp'
import salaryTransferArtwork from '@/assets/service-icons/salary-transfer.webp'
import violationArtwork from '@/assets/service-icons/violation.webp'
import warningArtwork from '@/assets/service-icons/warning.webp'

import { cn } from '@/lib/utils'

export type ServiceArtworkId =
  | 'acknowledgment'
  | 'administrative-leave'
  | 'duty-locations'
  | 'duty-resumption'
  | 'employee-absence'
  | 'employee-clearance'
  | 'general-book'
  | 'hr-request'
  | 'inmate-conduct'
  | 'leave-application'
  | 'leave-permit'
  | 'material-request'
  | 'national-service'
  | 'passport-release'
  | 'passport-release-list'
  | 'report'
  | 'resignation-letter'
  | 'salary-deduction'
  | 'salary-transfer'
  | 'violation'
  | 'warning'

type ServiceMotion =
  | 'absence'
  | 'alert'
  | 'approve'
  | 'caution'
  | 'chart'
  | 'clear'
  | 'conduct'
  | 'deduct'
  | 'depart'
  | 'deposit'
  | 'permit'
  | 'register'
  | 'release-list'
  | 'request'
  | 'request-profile'
  | 'schedule'
  | 'service'
  | 'sign'
  | 'transfer'
  | 'return'

const ARTWORK_SRC: Record<ServiceArtworkId, string> = {
  acknowledgment: acknowledgmentArtwork,
  'administrative-leave': administrativeLeaveArtwork,
  'duty-locations': dutyLocationsArtwork,
  'duty-resumption': dutyResumptionArtwork,
  'employee-absence': employeeAbsenceArtwork,
  'employee-clearance': employeeClearanceArtwork,
  'general-book': generalBookArtwork,
  'hr-request': hrRequestArtwork,
  'inmate-conduct': inmateConductArtwork,
  'leave-application': leaveApplicationArtwork,
  'leave-permit': leavePermitArtwork,
  'material-request': materialRequestArtwork,
  'national-service': nationalServiceArtwork,
  'passport-release': passportReleaseArtwork,
  'passport-release-list': passportReleaseListArtwork,
  report: reportArtwork,
  'resignation-letter': resignationLetterArtwork,
  'salary-deduction': salaryDeductionArtwork,
  'salary-transfer': salaryTransferArtwork,
  violation: violationArtwork,
  warning: warningArtwork,
}

const MOTION_BY_ARTWORK: Partial<Record<ServiceArtworkId, ServiceMotion>> = {
  acknowledgment: 'sign',
  'administrative-leave': 'schedule',
  'duty-locations': 'transfer',
  'duty-resumption': 'return',
  'employee-absence': 'absence',
  'employee-clearance': 'clear',
  'general-book': 'register',
  'hr-request': 'request-profile',
  'inmate-conduct': 'conduct',
  'leave-application': 'approve',
  'leave-permit': 'permit',
  'material-request': 'request',
  'national-service': 'service',
  'passport-release-list': 'release-list',
  report: 'chart',
  'resignation-letter': 'depart',
  'salary-deduction': 'deduct',
  'salary-transfer': 'deposit',
  violation: 'alert',
  warning: 'caution',
}

interface ServiceArtworkProps {
  artwork: ServiceArtworkId
  className?: string
  size?: 'dashboard' | 'gallery' | 'row' | 'inline'
}

const SIZE_CLASS_NAME: Record<NonNullable<ServiceArtworkProps['size']>, string> = {
  dashboard: 'h-14 w-14',
  gallery: 'h-8 w-8',
  row: 'h-6 w-6',
  inline: 'h-4 w-4',
}

export function ServiceArtwork({
  artwork,
  className,
  size = 'dashboard',
}: ServiceArtworkProps): React.JSX.Element {
  const motion = MOTION_BY_ARTWORK[artwork]
  const sizeClassName = SIZE_CLASS_NAME[size]

  return (
    <span
      className={cn(
        'service-artwork relative inline-grid place-items-center',
        sizeClassName,
        className,
      )}
      data-service-artwork={artwork}
      data-service-size={size}
      aria-hidden="true"
    >
      <img
        src={ARTWORK_SRC[artwork]}
        alt=""
        draggable={false}
        className={cn('relative z-[1] object-contain', sizeClassName)}
      />
      {motion && (
        <span
          className="service-artwork-accent pointer-events-none absolute z-[2]"
          data-service-motion={motion}
        />
      )}
    </span>
  )
}
