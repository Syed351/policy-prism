/**
 * Demo corpus.
 *
 * This is the Policy Prism demo library, carried over verbatim from the
 * prototype: 28 regulatory requirements across CMS, HIPAA, EMTALA, CLIA, TJC
 * and Ohio state licensure, and 17 policies for Riverbend Regional Medical
 * Center. The wording is preserved so the demo scores the same way it always
 * has - some requirements land as covered, some as partial, and some are
 * deliberately left uncovered so the gap and remediation views have real work
 * to show.
 */

import type { Framework, PolicyScope } from '@policy-prism/shared';

export interface SeedRegulation {
  framework: Framework;
  citation: string;
  applicability: string;
  title: string;
  requirementText: string;
  effectiveDate?: string;
  sourceRef?: string;
}

export interface SeedPolicy {
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string;
  scope: PolicyScope;
  text: string;
}

export const SEED_REGULATIONS: SeedRegulation[] = [
  {
    framework: "CMS",
    citation: "§482.13(a)(1)",
    applicability: "medicare",
    title: "Notice of patient rights",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The hospital must inform each patient, or when appropriate the patient representative, of the patient rights in advance of furnishing or discontinuing patient care whenever possible.",
  },
  {
    framework: "CMS",
    citation: "§482.13(b)(2)",
    applicability: "medicare",
    title: "Participation in care planning",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The patient has the right to participate in the development and implementation of his or her plan of care, including pain management and discharge planning.",
  },
  {
    framework: "CMS",
    citation: "§482.13(e)(1)",
    applicability: "medicare",
    title: "Freedom from restraint or seclusion",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "All patients have the right to be free from physical or mental abuse, and from restraint or seclusion imposed as a means of coercion, discipline, convenience, or retaliation by staff.",
  },
  {
    framework: "CMS",
    citation: "§482.13(e)(8)",
    applicability: "medicare",
    title: "Restraint order renewal limits",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "Each order for restraint or seclusion used for the management of violent or self destructive behavior must be renewed every 4 hours for adults, every 2 hours for children ages 9 to 17, and every hour for children under age 9.",
  },
  {
    framework: "CMS",
    citation: "§482.23(b)",
    applicability: "medicare",
    title: "Adequate nursing staff",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The nursing service must have adequate numbers of licensed registered nurses, licensed practical nurses, and other personnel to provide nursing care to all patients as needed, with a supervisory nurse on each shift.",
  },
  {
    framework: "CMS",
    citation: "§482.24(c)(1)",
    applicability: "medicare",
    title: "Medical record content and accuracy",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The medical record must contain information to justify admission and continued hospitalization, support the diagnosis, and describe the patient progress and response to treatment. Entries must be legible, complete, dated, timed and authenticated.",
  },
  {
    framework: "CMS",
    citation: "§482.24(b)(1)",
    applicability: "medicare",
    title: "Medical record retention",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "Medical records must be retained in their original or legally reproduced form for a period of at least 5 years, and be readily accessible for authorized retrieval.",
  },
  {
    framework: "CMS",
    citation: "§482.42(a)",
    applicability: "medicare",
    title: "Infection prevention program",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The hospital must have an active hospital wide infection prevention and control program, led by a designated infection preventionist, that includes surveillance, prevention and control of healthcare associated infections and reporting to leadership.",
  },
  {
    framework: "CMS",
    citation: "§482.55(a)(2)",
    applicability: "ed",
    title: "Emergency services supervision",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "Emergency services must be supervised by a qualified member of the medical staff, and there must be adequate medical and nursing personnel qualified in emergency care to meet the written emergency procedures and needs anticipated by the facility.",
  },
  {
    framework: "CMS",
    citation: "§482.41(c)(4)",
    applicability: "medicare",
    title: "Ventilation, light and temperature controls",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "There must be proper ventilation, light and temperature controls in pharmaceutical, food preparation, operating, recovery, intensive care and patient care areas, with humidity and air exchange monitored and documented.",
  },
  {
    framework: "CMS",
    citation: "§482.58(b)(1)",
    applicability: "swing",
    title: "Swing bed resident rights and services",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The hospital furnishing swing bed services must meet the resident rights requirements, including the right to be informed of services and charges, the right to manage personal funds, and the right to refuse transfer between rooms. Social services, patient activities and specialized rehabilitative services must be provided to meet the needs of each swing bed patient.",
  },
  {
    framework: "CMS",
    citation: "§482.58(b)(4)",
    applicability: "swing",
    title: "Swing bed dental and specialized services",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The hospital must assist swing bed patients in obtaining routine and emergency dental care, must provide or obtain specialized rehabilitative services to attain or maintain the highest practicable level of functioning, and must have a comprehensive care plan for each swing bed patient reviewed periodically by qualified personnel.",
  },
  {
    framework: "CMS",
    citation: "§482.60(b)",
    applicability: "psych",
    title: "Psychiatric unit staffing and treatment plans",
    sourceRef: "42 CFR Part 482 — Conditions of Participation for Hospitals",
    requirementText:
      "The psychiatric hospital or unit must have adequate numbers of registered nurses, psychiatrists, social workers and therapists to formulate and carry out an individual comprehensive treatment plan for each patient.",
  },
  {
    framework: "HIPAA",
    citation: "§164.308(a)(1)",
    applicability: "always",
    title: "Security management process",
    sourceRef: "45 CFR Parts 160/164 — HIPAA Security and Breach Notification Rules",
    requirementText:
      "Implement policies and procedures to prevent, detect, contain and correct security violations, including an accurate and thorough risk analysis, risk management measures, a sanction policy for workforce members, and regular review of information system activity.",
  },
  {
    framework: "HIPAA",
    citation: "§164.308(a)(5)",
    applicability: "always",
    title: "Security awareness and training",
    sourceRef: "45 CFR Parts 160/164 — HIPAA Security and Breach Notification Rules",
    requirementText:
      "Implement a security awareness and training program for all workforce members, including periodic security reminders, protection from malicious software, log in monitoring, and password management procedures.",
  },
  {
    framework: "HIPAA",
    citation: "§164.312(a)(1)",
    applicability: "always",
    title: "Technical access control",
    sourceRef: "45 CFR Parts 160/164 — HIPAA Security and Breach Notification Rules",
    requirementText:
      "Implement technical policies and procedures that allow access only to those persons granted access rights, including unique user identification, an emergency access procedure, automatic logoff, and encryption and decryption of electronic protected health information.",
  },
  {
    framework: "HIPAA",
    citation: "§164.312(b)",
    applicability: "always",
    title: "Audit controls",
    sourceRef: "45 CFR Parts 160/164 — HIPAA Security and Breach Notification Rules",
    requirementText:
      "Implement hardware, software, and procedural mechanisms that record and examine activity in information systems that contain or use electronic protected health information, and review audit logs on a defined schedule.",
  },
  {
    framework: "HIPAA",
    citation: "§164.404(b)",
    applicability: "always",
    title: "Breach notification to individuals",
    sourceRef: "45 CFR Parts 160/164 — HIPAA Security and Breach Notification Rules",
    requirementText:
      "Following the discovery of a breach of unsecured protected health information, notify each affected individual without unreasonable delay and in no case later than 60 calendar days after discovery of the breach.",
  },
  {
    framework: "EMTALA",
    citation: "§489.24(a)(1)",
    applicability: "ed",
    title: "Medical screening examination",
    sourceRef: "42 CFR §489.24 — Emergency Medical Treatment and Labor Act",
    requirementText:
      "If an individual comes to the emergency department and requests examination or treatment, the hospital must provide an appropriate medical screening examination within the capability of the emergency department to determine whether an emergency medical condition exists, regardless of ability to pay.",
  },
  {
    framework: "EMTALA",
    citation: "§489.24(e)(2)",
    applicability: "ed",
    title: "Appropriate transfer of unstable patients",
    sourceRef: "42 CFR §489.24 — Emergency Medical Treatment and Labor Act",
    requirementText:
      "A transfer of an individual with an unstabilized emergency medical condition is appropriate only if the physician certifies that the medical benefits outweigh the risks, the receiving facility has available space and qualified personnel and has agreed to accept the transfer, and medical records are sent with the individual.",
  },
  {
    framework: "EMTALA",
    citation: "§489.20(q)",
    applicability: "ed",
    title: "Posted signage of EMTALA rights",
    sourceRef: "42 CFR §489.24 — Emergency Medical Treatment and Labor Act",
    requirementText:
      "The hospital must post conspicuously in the emergency department and admitting areas signs specifying the rights of individuals with emergency medical conditions and women in labor, and whether the facility participates in the Medicaid program.",
  },
  {
    framework: "CLIA",
    citation: "§493.1251(a)",
    applicability: "lab",
    title: "Laboratory procedure manual",
    sourceRef: "42 CFR Part 493 — Clinical Laboratory Improvement Amendments",
    requirementText:
      "A written procedure manual for the performance of all analytic methods used in the laboratory must be available to and followed by testing personnel, and must be reviewed and approved by the laboratory director.",
  },
  {
    framework: "CLIA",
    citation: "§493.1235",
    applicability: "lab",
    title: "Testing personnel competency assessment",
    sourceRef: "42 CFR Part 493 — Clinical Laboratory Improvement Amendments",
    requirementText:
      "The laboratory must evaluate and document the competency of each testing person semiannually during the first year the individual tests patient specimens, and at least annually thereafter, using direct observation and blind sample testing.",
  },
  {
    framework: "TJC",
    citation: "LD.04.01.07",
    applicability: "accredited",
    title: "Policies and procedures are approved and current",
    sourceRef: "The Joint Commission Comprehensive Accreditation Manual for Hospitals",
    requirementText:
      "The hospital has policies and procedures that guide and support patient care, and leaders approve them. Policies are reviewed on a defined cycle, dated, and made available to staff who need them, and superseded versions are retained according to the record retention schedule.",
  },
  {
    framework: "TJC",
    citation: "PC.01.02.03",
    applicability: "accredited",
    title: "Patient assessment and reassessment timeframes",
    sourceRef: "The Joint Commission Comprehensive Accreditation Manual for Hospitals",
    requirementText:
      "The hospital assesses and reassesses the patient and the patient condition according to defined timeframes. The scope and intensity of assessment are based on the patient needs and the setting of care, and reassessment occurs in response to a significant change in condition or diagnosis.",
  },
  {
    framework: "TJC",
    citation: "EC.02.05.01",
    applicability: "accredited",
    title: "Utility systems risks are managed",
    sourceRef: "The Joint Commission Comprehensive Accreditation Manual for Hospitals",
    requirementText:
      "The hospital manages risks associated with its utility systems, maintains a written inventory of operating components, identifies the activities and intervals for inspecting, testing and maintaining those components, and labels utility system controls to facilitate partial or complete emergency shutdown.",
  },
  {
    framework: "State",
    citation: "OAC 3701-83-19",
    applicability: "state:OH",
    title: "Unusual incident reporting",
    sourceRef: "Ohio Administrative Code 3701-83 — Health Care Facilities",
    requirementText:
      "The health care facility shall report unusual incidents involving patient death, serious injury, elopement or suspected abuse to the director of health within the timeframe prescribed by the department, and maintain an internal incident log.",
  },
  {
    framework: "State",
    citation: "OAC 3701-83-05",
    applicability: "state:OH",
    title: "Quality assessment and performance improvement",
    sourceRef: "Ohio Administrative Code 3701-83 — Health Care Facilities",
    requirementText:
      "Each facility shall maintain an ongoing quality assessment and performance improvement program that measures and analyzes performance, tracks adverse events, and demonstrates measurable improvement with governing body oversight.",
  },
];

export const SEED_POLICIES: SeedPolicy[] = [
  {
    code: "PR-100",
    title: "Patient Rights and Responsibilities",
    owner: "Patient Experience",
    version: "4.2",
    effectiveDate: "2025-03-14",
    scope: "regulatory",
    text:
      "Riverbend Regional informs each patient or the patient representative of their rights in advance of furnishing or discontinuing care. A written notice of patient rights is provided at registration and posted in all patient care areas. Patients have the right to participate in the development and implementation of their plan of care, including pain management and discharge planning, and to refuse treatment.",
  },
  {
    code: "PR-220",
    title: "Restraint and Seclusion",
    owner: "Nursing Administration",
    version: "2.8",
    effectiveDate: "2024-11-02",
    scope: "regulatory",
    text:
      "Patients have the right to be free from restraint or seclusion imposed as a means of coercion, discipline, convenience or retaliation by staff. Restraint is used only when less restrictive interventions have failed and must be ordered by a physician. Orders must be time limited and reassessed by the attending physician.",
  },
  {
    code: "NS-310",
    title: "Nurse Staffing Plan",
    owner: "Chief Nursing Officer",
    version: "6.0",
    effectiveDate: "2025-06-01",
    scope: "regulatory",
    text:
      "The nursing service maintains adequate numbers of licensed registered nurses, licensed practical nurses and support personnel to provide nursing care to all patients as needed. A supervisory registered nurse is assigned to each shift on every unit. Staffing matrices are reviewed quarterly against patient acuity.",
  },
  {
    code: "HIM-410",
    title: "Medical Record Documentation Standards",
    owner: "Health Information Management",
    version: "3.5",
    effectiveDate: "2025-01-20",
    scope: "regulatory",
    text:
      "The medical record must contain information to justify admission and continued hospitalization, support the diagnosis and describe the patient progress and response to treatment. All entries must be legible, complete, dated, timed and authenticated by the responsible practitioner. Delinquent records are tracked weekly.",
  },
  {
    code: "HIM-430",
    title: "Health Information Retention Schedule",
    owner: "Health Information Management",
    version: "2.1",
    effectiveDate: "2024-08-15",
    scope: "regulatory",
    text:
      "Medical records are retained in original or legally reproduced electronic form for a minimum of seven years from the date of discharge, and records of minors are retained until age twenty one. Records are readily accessible for authorized retrieval through the enterprise archive.",
  },
  {
    code: "IC-500",
    title: "Infection Prevention and Control Plan",
    owner: "Infection Prevention",
    version: "5.3",
    effectiveDate: "2025-04-08",
    scope: "regulatory",
    text:
      "Riverbend maintains an active hospital wide infection prevention and control program led by a designated infection preventionist who reports to the quality committee and governing body. The program includes surveillance of healthcare associated infections, prevention and control interventions, hand hygiene auditing and antibiotic stewardship.",
  },
  {
    code: "ED-610",
    title: "Emergency Department Operations",
    owner: "Emergency Services",
    version: "4.9",
    effectiveDate: "2025-05-19",
    scope: "regulatory",
    text:
      "Emergency services are supervised by a qualified member of the medical staff designated as ED medical director. Adequate medical and nursing personnel qualified in emergency care are scheduled to meet anticipated volume. Any individual who comes to the emergency department requesting examination or treatment receives an appropriate medical screening examination within the capability of the department to determine whether an emergency medical condition exists, regardless of ability to pay or insurance status.",
  },
  {
    code: "ED-640",
    title: "Patient Transfer and EMTALA Compliance",
    owner: "Emergency Services",
    version: "3.2",
    effectiveDate: "2025-02-27",
    scope: "regulatory",
    text:
      "Transfer of an individual with an unstabilized emergency medical condition occurs only when the physician certifies in writing that the medical benefits of transfer outweigh the risks. The receiving facility must have available space and qualified personnel and must agree to accept the transfer. Copies of medical records related to the emergency condition are sent with the individual.",
  },
  {
    code: "IS-710",
    title: "Information Security Risk Management",
    owner: "Information Security",
    version: "3.0",
    effectiveDate: "2025-07-11",
    scope: "regulatory",
    text:
      "The information security program implements policies and procedures to prevent, detect, contain and correct security violations. An accurate and thorough risk analysis of systems containing electronic protected health information is conducted annually, risk management measures are tracked to closure, and a sanction policy applies to workforce members who violate security policy.",
  },
  {
    code: "IS-730",
    title: "Workforce Security Awareness Training",
    owner: "Information Security",
    version: "2.4",
    effectiveDate: "2025-01-09",
    scope: "regulatory",
    text:
      "All workforce members complete a security awareness and training program at hire and annually. The program includes periodic security reminders, phishing simulations, protection from malicious software, and password management procedures. Completion is tracked and escalated to managers.",
  },
  {
    code: "IS-745",
    title: "System Access Control",
    owner: "Information Security",
    version: "2.9",
    effectiveDate: "2024-12-05",
    scope: "regulatory",
    text:
      "Access to clinical information systems is granted only to persons with approved access rights based on role. Each user is assigned a unique user identification. Workstations enforce automatic logoff after fifteen minutes of inactivity. An emergency access procedure is available to clinical leadership during downtime.",
  },
  {
    code: "LAB-810",
    title: "Laboratory Procedure Manual Control",
    owner: "Clinical Laboratory",
    version: "7.1",
    effectiveDate: "2025-03-30",
    scope: "regulatory",
    text:
      "A written procedure manual for the performance of all analytic methods used in the laboratory is maintained in the document control system, is available to and followed by testing personnel at the bench, and is reviewed and approved by the laboratory director annually and upon any procedure change.",
  },
  {
    code: "QA-905",
    title: "Unusual Incident and Event Reporting",
    owner: "Quality and Safety",
    version: "4.4",
    effectiveDate: "2025-06-22",
    scope: "regulatory",
    text:
      "Unusual incidents involving patient death, serious injury, elopement or suspected abuse are reported to the Ohio director of health within the prescribed timeframe. An internal incident log is maintained in the safety event reporting system and reviewed at the weekly safety huddle.",
  },
  {
    code: "EC-950",
    title: "Utility Systems Management",
    owner: "Facilities and Plant Operations",
    version: "2.0",
    effectiveDate: "2021-04-12",
    scope: "regulatory",
    text:
      "Riverbend manages risks associated with its utility systems. A written inventory of operating components is maintained, activities and intervals for inspecting, testing and maintaining those components are defined, and utility system controls are labeled to facilitate partial or complete emergency shutdown. The inventory is reviewed by the environment of care committee.",
  },
  {
    code: "ADM-020",
    title: "Employee Parking and Site Access",
    owner: "Administration",
    version: "1.4",
    effectiveDate: "2025-02-01",
    scope: "operational",
    text:
      "Employees park in designated staff lots and display a current permit. Permits are renewed annually through the badge office. Patient and visitor spaces are reserved at all times and vehicles parked in them may be towed at the owner expense.",
  },
  {
    code: "ADM-045",
    title: "Policy and Procedure Governance",
    owner: "Administration",
    version: "3.0",
    effectiveDate: "2025-06-14",
    scope: "governance",
    text:
      "All hospital policies follow a standard template, carry an owner, a version number and an effective date, and are approved by the responsible committee before publication. Policies are reviewed at least every three years or when a regulation changes. Superseded versions are retained in the document control system.",
  },
  {
    code: "QA-910",
    title: "Quality Assessment and Performance Improvement",
    owner: "Quality and Safety",
    version: "5.0",
    effectiveDate: "2025-05-02",
    scope: "regulatory",
    text:
      "Riverbend maintains an ongoing quality assessment and performance improvement program that measures and analyzes performance across clinical and operational domains, tracks adverse events and near misses, and demonstrates measurable improvement. The governing body provides oversight and approves annual priorities.",
  },
];
