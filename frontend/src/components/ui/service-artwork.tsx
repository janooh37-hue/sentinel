import acknowledgmentArtwork from '@/assets/service-icons/acknowledgment.webp'
import administrativeLeaveArtwork from '@/assets/service-icons/administrative-leave.webp'
import allowanceRequestArtwork from '@/assets/service-icons/allowance-request.webp'
import breachOfDisciplineArtwork from '@/assets/service-icons/breach-of-discipline.webp'
import dutyLocationsArtwork from '@/assets/service-icons/duty-locations.webp'
import dutyResumptionArtwork from '@/assets/service-icons/duty-resumption.webp'
import employeeAbsenceArtwork from '@/assets/service-icons/employee-absence.webp'
import employeeClearanceArtwork from '@/assets/service-icons/employee-clearance.webp'
import employeeExitArtwork from '@/assets/service-icons/employee-exit.webp'
import employeeExitContractArtwork from '@/assets/service-icons/employee-exit-contract.webp'
import employeeInformationArtwork from '@/assets/service-icons/employee-information.webp'
import employeeOvertimeArtwork from '@/assets/service-icons/employee-overtime.webp'
import employmentApplicationArtwork from '@/assets/service-icons/employment-application.webp'
import employmentOfferArtwork from '@/assets/service-icons/employment-offer.webp'
import expenseClaimArtwork from '@/assets/service-icons/expense-claim.webp'
import generalBookArtwork from '@/assets/service-icons/general-book.webp'
import hrRequestArtwork from '@/assets/service-icons/hr-request.webp'
import inmateConductArtwork from '@/assets/service-icons/inmate-conduct.webp'
import interviewAssessmentArtwork from '@/assets/service-icons/interview-assessment.webp'
import interviewScoresArtwork from '@/assets/service-icons/interview-scores.webp'
import jobDescriptionArtwork from '@/assets/service-icons/job-description.webp'
import leaveApplicationArtwork from '@/assets/service-icons/leave-application.webp'
import leaveEncashmentArtwork from '@/assets/service-icons/leave-encashment.webp'
import leavePermitArtwork from '@/assets/service-icons/leave-permit.webp'
import loanRequestArtwork from '@/assets/service-icons/loan-request.webp'
import manpowerRequisitionArtwork from '@/assets/service-icons/manpower-requisition.webp'
import materialRequestArtwork from '@/assets/service-icons/material-request.webp'
import nationalServiceArtwork from '@/assets/service-icons/national-service.webp'
import passportReleaseArtwork from '@/assets/service-icons/passport-release.webp'
import passportReleaseListArtwork from '@/assets/service-icons/passport-release-list.webp'
import performanceAppraisalArtwork from '@/assets/service-icons/performance-appraisal.webp'
import promotionIncrementArtwork from '@/assets/service-icons/promotion-increment.webp'
import reportArtwork from '@/assets/service-icons/report.webp'
import resignationLetterArtwork from '@/assets/service-icons/resignation-letter.webp'
import salaryAdvanceArtwork from '@/assets/service-icons/salary-advance.webp'
import salaryDeductionArtwork from '@/assets/service-icons/salary-deduction.webp'
import salaryTransferArtwork from '@/assets/service-icons/salary-transfer.webp'
import staffAttendanceArtwork from '@/assets/service-icons/staff-attendance.webp'
import vehicleAccidentArtwork from '@/assets/service-icons/vehicle-accident.webp'
import vehicleFinesArtwork from '@/assets/service-icons/vehicle-fines.webp'
import vehicleLicenceRenewalArtwork from '@/assets/service-icons/vehicle-licence-renewal.webp'
import vehicleMaintenanceArtwork from '@/assets/service-icons/vehicle-maintenance.webp'
import vehicleRegisterArtwork from '@/assets/service-icons/vehicle-register.webp'
import vehicleSitesArtwork from '@/assets/service-icons/vehicle-sites.webp'
import violationArtwork from '@/assets/service-icons/violation.webp'
import warningArtwork from '@/assets/service-icons/warning.webp'

import { cn } from '@/lib/utils'

export type ServiceArtworkId =
  | 'acknowledgment'
  | 'administrative-leave'
  | 'allowance-request'
  | 'breach-of-discipline'
  | 'duty-locations'
  | 'duty-resumption'
  | 'employee-absence'
  | 'employee-clearance'
  | 'employee-exit'
  | 'employee-exit-contract'
  | 'employee-information'
  | 'employee-overtime'
  | 'employment-application'
  | 'employment-offer'
  | 'expense-claim'
  | 'general-book'
  | 'hr-request'
  | 'inmate-conduct'
  | 'interview-assessment'
  | 'interview-scores'
  | 'job-description'
  | 'leave-application'
  | 'leave-encashment'
  | 'leave-permit'
  | 'loan-request'
  | 'manpower-requisition'
  | 'material-request'
  | 'national-service'
  | 'passport-release'
  | 'passport-release-list'
  | 'performance-appraisal'
  | 'promotion-increment'
  | 'report'
  | 'resignation-letter'
  | 'salary-advance'
  | 'salary-deduction'
  | 'salary-transfer'
  | 'staff-attendance'
  | 'vehicle-accident'
  | 'vehicle-fines'
  | 'vehicle-licence-renewal'
  | 'vehicle-maintenance'
  | 'vehicle-register'
  | 'vehicle-sites'
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
  'allowance-request': allowanceRequestArtwork,
  'breach-of-discipline': breachOfDisciplineArtwork,
  'duty-locations': dutyLocationsArtwork,
  'duty-resumption': dutyResumptionArtwork,
  'employee-absence': employeeAbsenceArtwork,
  'employee-clearance': employeeClearanceArtwork,
  'employee-exit': employeeExitArtwork,
  'employee-exit-contract': employeeExitContractArtwork,
  'employee-information': employeeInformationArtwork,
  'employee-overtime': employeeOvertimeArtwork,
  'employment-application': employmentApplicationArtwork,
  'employment-offer': employmentOfferArtwork,
  'expense-claim': expenseClaimArtwork,
  'general-book': generalBookArtwork,
  'hr-request': hrRequestArtwork,
  'inmate-conduct': inmateConductArtwork,
  'interview-assessment': interviewAssessmentArtwork,
  'interview-scores': interviewScoresArtwork,
  'job-description': jobDescriptionArtwork,
  'leave-application': leaveApplicationArtwork,
  'leave-encashment': leaveEncashmentArtwork,
  'leave-permit': leavePermitArtwork,
  'loan-request': loanRequestArtwork,
  'manpower-requisition': manpowerRequisitionArtwork,
  'material-request': materialRequestArtwork,
  'national-service': nationalServiceArtwork,
  'passport-release': passportReleaseArtwork,
  'passport-release-list': passportReleaseListArtwork,
  'performance-appraisal': performanceAppraisalArtwork,
  'promotion-increment': promotionIncrementArtwork,
  report: reportArtwork,
  'resignation-letter': resignationLetterArtwork,
  'salary-advance': salaryAdvanceArtwork,
  'salary-deduction': salaryDeductionArtwork,
  'salary-transfer': salaryTransferArtwork,
  'staff-attendance': staffAttendanceArtwork,
  'vehicle-accident': vehicleAccidentArtwork,
  'vehicle-fines': vehicleFinesArtwork,
  'vehicle-licence-renewal': vehicleLicenceRenewalArtwork,
  'vehicle-maintenance': vehicleMaintenanceArtwork,
  'vehicle-register': vehicleRegisterArtwork,
  'vehicle-sites': vehicleSitesArtwork,
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
