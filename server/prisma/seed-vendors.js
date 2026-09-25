/**
 * Seed vendor accounts from the Delphic vendor tracker sheet.
 *
 * Run after the base seed (team roster must exist):
 *   npm run seed
 *   npm run seed:vendors
 *
 * Only rows whose sheet Status is "Active" are imported. Re-running removes the
 * prior vendor-sheet import (accounts with source = 'vendor_csv') and recreates it.
 *
 * POC initials on the sheet map to the internal owner of the vendor account;
 * the vendor's own contact email goes to poc_email.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SOURCE = 'vendor_csv';

/** Sheet POC label (lower-cased) -> roster email that owns the vendor account. */
const POC_TO_EMAIL = {
  garv: 'Garv@delphic.in',
  krupali: 'krupali.vala@delphic.in',
  prashant: 'prashant.hada@delphic.in',
};
const FALLBACK_OWNER_EMAIL = 'admin@delphic.in';

/**
 * Active vendors only (Status = "Active" on the sheet).
 * Fields: name, note (sheet "Budget" column — free text), email, location, poc, tech.
 */
const ACTIVE_VENDORS = [
  { name: 'UBIQUE SYSTEMS', note: 'Not Responding', email: 'hritirpan.sinha@ubique-systems.com', location: 'Ahmedabad, Gurugram, Hyderabad, Indore, Noida, Pune, Remote', poc: '', tech: 'AI, CLOUD, Cyber Security, Data Analytics, Data Engineer, Power BI' },
  { name: 'AllupNext', note: '', email: '', location: 'Remote', poc: 'garv', tech: 'CRM, Content Creation, Dot net' },
  { name: 'Zordial', note: 'TechMatrix partner', email: '', location: 'Remote', poc: 'krupali', tech: 'Salesforce' },
  { name: 'CloudMetic', note: 'High budget', email: '', location: 'Remote', poc: 'prashant', tech: 'Salesforce' },
  { name: 'NeoSoft', note: '', email: 'sumeet.katti@neosofttech.com', location: 'Ahmedabad, Bangalore, Mumbai, Pune', poc: 'prashant', tech: 'SAP' },
  { name: 'Engineer Master Labs Pvt', note: '1.5', email: 'nandinee.kushwah@engineermaster.in', location: 'Remote', poc: '', tech: 'AI/ML, Data Engineer, Java, Mern, PHP, Python, UI/UX' },
  { name: 'ITeanz Tach', note: 'No Profiles', email: 'poojitha@iteanztechnologies.com', location: 'Bangalore, Hyderabad, Pune', poc: '', tech: 'SAP' },
  { name: 'Rudhra Info', note: 'Not Good Profiles', email: 'krati.sharma@octalsoftware.com', location: 'Hyderabad, Pune', poc: '', tech: 'AI/ML, Python, Salesforce' },
  { name: 'brown fox', note: '1.8LPM', email: '', location: 'Remote', poc: 'garv', tech: 'Salesforce' },
  { name: 'Manureva Digital', note: 'Remote High budget', email: '', location: '', poc: 'prashant', tech: 'Salesforce' },
  { name: 'Oak Tree Solutions', note: '1.8-2 LPM', email: 'vishal.khedekar@oaktreecloud.com', location: 'Remote', poc: 'garv', tech: 'Data Engineer, SAP, Salesforce, Service Now' },
  { name: 'techabbotsales', note: '1LPM- 5Y', email: '', location: 'Remote', poc: 'krupali', tech: 'Dot net, Mobile, PHP, Power BI' },
  { name: 'Nsqaure Xperts', note: 'High', email: 'sudhanshu.shekhar@nsquarexperts.com', location: 'Pune, Remote', poc: 'prashant', tech: 'Microsoft dynamics365, SAP, Salesforce' },
  { name: 'IBOTIX', note: '', email: 'mohammad.saif@ibotix.ai', location: 'Ahmedabad, Bangalore, Gurugram, Hyderabad, Indore, Mumbai, NCR, Noida, Pune', poc: 'garv', tech: 'AI/ML, AWS, Backend, Dot net, Frontend, Python, QA, SAP' },
  { name: 'NWS Soft', note: '', email: 'arushi.tyagi@nwssoft.com', location: 'Pune, Remote', poc: 'krupali', tech: 'Salesforce, Service Now' },
  { name: 'Panorama', note: '', email: 'ajay.rawat@panoramasoftware.in', location: 'Remote', poc: 'garv', tech: 'FullStack, QA, QA Automation' },
  { name: 'AngularMinds', note: '', email: 'vaishnavi.itubone@angularminds.com', location: 'Pune, Remote', poc: 'krupali', tech: 'FullStack, Mean, Mern, NodeJS, QA, React Js' },
  { name: 'Intellioz', note: '', email: 'varun@intellioz.com', location: 'Pan India', poc: 'garv', tech: 'Dot net, Microsoft dynamics365, Oracle' },
  { name: 'Bluetris', note: '', email: 'leena.choudhary@bluetris.com', location: 'Remote', poc: 'prashant', tech: 'Devops, Java' },
  { name: 'Golden Egale', note: '', email: 'Dharmendra@goldeneagle.ai', location: 'Indore, Pune, Remote', poc: 'prashant', tech: 'Data Analytics, Data Engineer, Data Science, Mean, Mern, ROR' },
  { name: 'Letitbex AI', note: '', email: 'MaruthiRao.Telaprolu@letitbexai.com', location: 'Hyderabad, Remote', poc: 'garv', tech: 'AI/ML, Dot net, GenAI, Salesforce' },
  { name: 'CubeXo', note: '', email: '', location: 'Remote', poc: 'krupali', tech: 'Devops, Java, Python, QA' },
  { name: 'LogiQuad Solutions', note: '', email: '', location: 'Remote', poc: 'garv', tech: 'AI/ML, Data Engineer, Devops, Java, QA' },
  { name: 'Aventra', note: '', email: '', location: 'Hyderabad, Remote', poc: 'prashant', tech: 'AI, GenAI' },
  { name: 'QudragentTech', note: '', email: '', location: 'Bangalore', poc: 'prashant', tech: 'Salesforce' },
  { name: 'SaasVerse', note: '', email: '', location: 'Jaipur', poc: 'prashant', tech: 'Salesforce, Service Now' },
  { name: 'AFORV', note: '', email: '', location: 'Bangalore, Remote', poc: 'garv', tech: 'AI Backend Engineer, Data Engineer, QA' },
  { name: 'Techvalens', note: '', email: '', location: 'Indore', poc: 'garv', tech: 'AI/ML, Java, Mern, Python' },
  { name: 'Phi Tech', note: '', email: 'ashu.yadav@phitechlabs.com', location: 'Noida', poc: 'krupali', tech: 'Data Engineer, QA Automation' },
  { name: 'Yuvasoft Solutions Pvt Ltd', note: '', email: 'Gagandeepb@yuvasoftech.com', location: 'Indore, Remote', poc: 'krupali', tech: 'AI/ML, Python, ROR, UI/UX' },
  { name: 'MenteStack', note: '', email: '', location: 'Bangalore, Indore, Remote', poc: 'krupali', tech: 'Agentic AI, GenAI, Java, Mern, ROR, SAP, Salesforce' },
  { name: 'Complere infosystem', note: '', email: '', location: 'Remote', poc: 'prashant', tech: 'Data Engineer' },
];

function parseSpecializations(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function loadOwners() {
  const users = await prisma.user.findMany();
  const byEmail = Object.fromEntries(users.map((u) => [u.email.toLowerCase(), u]));

  const fallback = byEmail[FALLBACK_OWNER_EMAIL.toLowerCase()] || users.find((u) => u.role === 'admin');
  if (!fallback) throw new Error('Team roster missing. Run `npm run seed` first.');

  const pocOwner = (poc) => {
    const email = POC_TO_EMAIL[String(poc || '').trim().toLowerCase()];
    return (email && byEmail[email.toLowerCase()]) || fallback;
  };

  return { pocOwner, fallback };
}

async function wipePriorImport() {
  await prisma.account.deleteMany({ where: { source: SOURCE } });
}

async function main() {
  console.log(`Seeding ${ACTIVE_VENDORS.length} active vendor accounts…`);

  const { pocOwner } = await loadOwners();
  await wipePriorImport();

  let created = 0;
  const byOwner = {};

  for (const v of ACTIVE_VENDORS) {
    const owner = pocOwner(v.poc);

    await prisma.account.create({
      data: {
        type: 'vendor',
        name: v.name.trim(),
        stage: 'active',
        source: SOURCE,
        owner_id: owner.id,
        industry: 'IT Services',
        location: v.location || null,
        location_country: 'IN',
        poc_email: v.email || null,
        meeting_notes: v.note || null,
        vendor_specializations: parseSpecializations(v.tech),
      },
    });

    created += 1;
    byOwner[owner.name] = (byOwner[owner.name] || 0) + 1;
  }

  console.log('Vendor seed complete.');
  console.log(JSON.stringify({
    vendors_created: created,
    by_owner: byOwner,
    total_vendor_accounts: await prisma.account.count({ where: { type: 'vendor' } }),
    total_accounts: await prisma.account.count(),
  }, null, 2));
}

require('./_guard').assertNonProdDestructive('prisma/seed-vendors.js');

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
