// The standard business classification the group started from (the "Business Expansion" list): 27 sectors, each with its industries and each industry
// with its sub-industries. It is only a starting point: it is loaded into the group's own tables ("Load the standard list") and from then on every
// sector, industry and sub-industry is edited, added or removed freely. Format: `# Sector`, then `Industry :: sub-industry, sub-industry, ...`.

const RAW = `
# Agriculture, Forestry & Fishing
Crop Production :: Cereals, Wheat, Rice, Maize, Pulses, Oilseeds, Sugarcane, Cotton, Tobacco, Fruits, Vegetables, Plantation Crops, Spices
Horticulture :: Floriculture, Nursery, Greenhouse Farming, Landscaping Plants, Hydroponics, Vertical Farming
Livestock :: Cattle Farming, Buffalo Farming, Sheep Farming, Goat Farming, Pig Farming, Animal Breeding
Dairy :: Milk Production, Milk Processing, Cheese, Butter, Yogurt, Dairy Ingredients
Poultry :: Broiler Farming, Layer Farming, Hatcheries, Egg Production
Fisheries :: Marine Fishing, Inland Fishing, Commercial Fishing, Fish Processing
Aquaculture :: Fish Farming, Shrimp Farming, Prawn Farming, Oyster Farming, Seaweed Farming
Forestry :: Timber, Plantation Forestry, Agroforestry, Forest Management
Agricultural Inputs :: Seeds, Fertilizers, Pesticides, Herbicides, Agricultural Chemicals
AgriTech :: Precision Agriculture, Farm Management Software, Agricultural Drones, Smart Irrigation, Agricultural Robotics
Agricultural Services :: Farm Consultancy, Soil Testing, Crop Insurance, Agricultural Equipment Rental

# Mining, Metals & Natural Resources
Coal Mining :: Thermal Coal, Metallurgical Coal, Lignite
Iron Ore Mining :: Iron Ore Extraction, Iron Ore Processing
Precious Metals :: Gold, Silver, Platinum, Palladium
Base Metals :: Copper, Aluminium, Zinc, Lead, Nickel, Tin
Strategic Minerals :: Lithium, Cobalt, Graphite, Rare Earth Elements
Industrial Minerals :: Limestone, Gypsum, Silica, Phosphate, Potash
Stone & Aggregates :: Granite, Marble, Sand, Gravel, Crushed Stone
Mineral Processing :: Crushing, Grinding, Beneficiation, Smelting
Mining Services :: Drilling, Blasting, Mine Engineering, Mining Equipment
Oil & Gas Extraction :: Onshore Exploration, Offshore Exploration, Drilling Services

# Oil, Gas, Energy & Power
Oil Exploration :: Onshore Oil, Offshore Oil, Oilfield Services
Oil Production :: Crude Oil Extraction, Enhanced Oil Recovery
Oil Refining :: Petroleum Refining, Lubricants, Bitumen
Natural Gas :: Gas Exploration, Gas Production, LNG, CNG, LPG
Petrochemicals :: Ethylene, Propylene, Methanol, Aromatics
Renewable Energy :: Solar, Wind, Hydropower, Geothermal, Biomass
Nuclear Energy :: Nuclear Power Generation, Nuclear Fuel, Nuclear Engineering
Electricity :: Power Generation, Transmission, Distribution
Energy Storage :: Lithium-Ion Batteries, Grid Storage, Hydrogen Storage
Energy Services :: Energy Auditing, Energy Management, Power Trading
Hydrogen :: Green Hydrogen, Blue Hydrogen, Hydrogen Fuel Infrastructure
Smart Energy :: Smart Grids, Smart Meters, Energy Management Systems

# Manufacturing & Industrial Production
Automotive Manufacturing :: Passenger Cars, Commercial Vehicles, Two-Wheelers, Three-Wheelers
Automotive Components :: Engines, Transmissions, Brakes, Tyres, Batteries, Electronics
Electronics :: Consumer Electronics, Industrial Electronics, Semiconductors, Circuit Boards
Electrical Equipment :: Transformers, Switchgear, Motors, Generators, Cables
Machinery :: Industrial Machinery, Agricultural Machinery, Construction Machinery, Textile Machinery
Heavy Engineering :: Heavy Fabrication, Industrial Equipment, Pressure Vessels, Boilers
Steel & Metal Products :: Steel Production, Metal Fabrication, Aluminium Products, Metal Casting
Chemical Manufacturing :: Industrial Chemicals, Specialty Chemicals, Organic Chemicals, Inorganic Chemicals
Pharmaceutical Manufacturing :: APIs, Formulations, Generic Medicines, Biopharmaceuticals
Textile Manufacturing :: Yarn, Fabric, Knitting, Weaving, Dyeing, Finishing
Apparel Manufacturing :: Garments, Sportswear, Uniforms, Fashion Clothing
Plastic Manufacturing :: Plastic Packaging, Plastic Components, Moulded Products
Rubber Manufacturing :: Tyres, Industrial Rubber, Rubber Components
Paper Manufacturing :: Paper, Paperboard, Tissue, Packaging Paper
Food Manufacturing :: Processed Foods, Frozen Foods, Canned Foods, Packaged Foods
Beverage Manufacturing :: Soft Drinks, Juices, Bottled Water, Tea, Coffee, Alcoholic Beverages
Furniture Manufacturing :: Residential Furniture, Office Furniture, Industrial Furniture
Glass & Ceramics :: Flat Glass, Containers, Ceramic Tiles, Sanitaryware, Industrial Ceramics
Cement & Construction Materials :: Cement, Concrete, Bricks, Blocks, Prefabricated Products
Aerospace Manufacturing :: Aircraft, Aircraft Components, Engines, Avionics
Defence Manufacturing :: Weapons Systems, Military Vehicles, Defence Electronics, Ammunition
Medical Manufacturing :: Medical Devices, Surgical Instruments, Diagnostic Equipment
Packaging Manufacturing :: Cartons, Bottles, Flexible Packaging, Labels
Jewellery Manufacturing :: Gold, Silver, Diamond, Precious Stone Jewellery
Printing :: Commercial Printing, Digital Printing, Labels, Packaging Printing

# Construction, Infrastructure & Real Estate
Residential Construction :: Individual Houses, Apartments, Villas, Housing Projects
Commercial Construction :: Offices, Shopping Malls, Hotels, Retail Buildings
Industrial Construction :: Factories, Warehouses, Manufacturing Plants
Infrastructure Construction :: Roads, Highways, Bridges, Tunnels, Airports
Civil Engineering :: Structural Engineering, Geotechnical Engineering, Transportation Engineering
Electrical Contracting :: Building Electrical Systems, Power Installations
Mechanical Contracting :: HVAC, Plumbing, Fire Protection
Interior Design :: Residential Interiors, Commercial Interiors, Hospitality Interiors
Architecture :: Building Architecture, Landscape Architecture, Urban Planning
Real Estate Development :: Residential Development, Commercial Development, Industrial Parks
Real Estate Brokerage :: Residential Brokerage, Commercial Brokerage, Industrial Property Brokerage
Property Management :: Residential Management, Commercial Management, Facility Operations
Real Estate Investment :: REITs, Property Funds, Real Estate Private Equity
Building Materials :: Cement, Steel, Tiles, Glass, Doors, Windows, Roofing
Prefabricated Construction :: Modular Buildings, Prefab Homes, Precast Concrete
Infrastructure Operations :: Toll Roads, Airports, Ports, Railway Infrastructure
Property Technology :: Real Estate Software, Property Marketplaces, Smart Buildings

# Information Technology & Software
Software Development :: Custom Software, Enterprise Software, Application Development
SaaS :: HRMS, CRM, ERP, Accounting Software, Project Management Software
Artificial Intelligence :: Generative AI, Machine Learning, Deep Learning, Computer Vision, NLP
Data & Analytics :: Data Engineering, Data Science, Business Intelligence, Big Data
Cloud Computing :: IaaS, PaaS, Cloud Infrastructure, Cloud Migration
Cybersecurity :: Network Security, Endpoint Security, Identity Management, Security Operations
IT Services :: IT Consulting, Managed IT Services, IT Support, System Integration
Enterprise Technology :: ERP, CRM, SCM, HCM, Enterprise Content Management
Database Technology :: Database Management, Data Warehousing, Database Administration
Application Infrastructure :: API Management, Middleware, DevOps, Microservices
Web Technology :: Web Development, E-Commerce Development, Web Hosting
Mobile Technology :: Android Development, iOS Development, Mobile Applications
Blockchain :: Distributed Ledger, Smart Contracts, Enterprise Blockchain
Robotics Software :: Industrial Robotics, Robotic Process Automation, Autonomous Systems
Gaming Technology :: Game Engines, Game Development, Gaming Platforms
IT Hardware :: Servers, Computers, Storage Devices, Networking Equipment
Emerging Technology :: Quantum Computing, Edge Computing, Digital Twins, AR, VR

# Telecommunications & Communication
Telecom Operators :: Mobile Operators, Fixed-Line Operators
Internet Services :: Broadband, Fibre Internet, Wireless Internet
Network Infrastructure :: Fibre Optics, Telecom Towers, Data Transmission
Wireless Communication :: 4G, 5G, 6G, Wi-Fi Technology
Satellite Communication :: Satellite Internet, Satellite Broadcasting
Telecom Equipment :: Routers, Switches, Base Stations, Network Hardware
Communication Services :: Unified Communications, VoIP, Video Conferencing
Telecom Software :: OSS, BSS, Network Management
Data Connectivity :: Private Networks, Enterprise Connectivity, IoT Connectivity

# Banking, Financial Services & Insurance
Commercial Banking :: Retail Banking, Corporate Banking, Business Banking
Investment Banking :: Mergers & Acquisitions, IPO Advisory, Debt Capital Markets
Private Banking :: High-Net-Worth Banking, Wealth Advisory
Lending :: Personal Loans, Business Loans, Home Loans, Vehicle Loans
NBFC :: Asset Financing, Consumer Finance, Equipment Finance
Microfinance :: Microcredit, Group Lending, Rural Finance
Insurance :: Life, Health, Motor, Property, Travel, Commercial Insurance
Reinsurance :: Life Reinsurance, Non-Life Reinsurance
Asset Management :: Mutual Funds, Portfolio Management, Pension Funds
Wealth Management :: Financial Planning, Private Wealth, Family Office
Capital Markets :: Stockbroking, Securities Trading, Equity Research
Private Equity :: Buyouts, Growth Equity, Special Situations
Venture Capital :: Seed Funding, Early Stage, Growth Stage
Alternative Investments :: Hedge Funds, Private Credit, Infrastructure Funds
FinTech :: Digital Banking, Payment Technology, Financial Software
Payments :: Payment Gateways, Merchant Acquiring, Digital Wallets, Remittances
Credit Services :: Credit Rating, Credit Bureau, Credit Risk Analytics
Financial Infrastructure :: Clearing, Settlement, Custody, Exchanges
Financial Advisory :: Tax Planning, Investment Advisory, Corporate Finance

# Healthcare, Pharmaceuticals & Life Sciences
Hospitals :: Multi-Specialty, Super-Specialty, General Hospitals
Clinics :: General Practice, Specialist Clinics, Outpatient Centres
Diagnostics :: Pathology, Radiology, Imaging, Molecular Diagnostics
Pharmaceuticals :: Drug Development, Generic Medicines, Branded Medicines
Biotechnology :: Genetic Engineering, Cell Therapy, Gene Therapy
Medical Devices :: Imaging Equipment, Patient Monitoring, Surgical Devices
Medical Supplies :: Consumables, Surgical Supplies, Hospital Equipment
Dental Care :: Dental Clinics, Orthodontics, Dental Laboratories
Eye Care :: Ophthalmology, Optometry, Optical Retail
Mental Healthcare :: Psychiatry, Counselling, Psychology
Home Healthcare :: Home Nursing, Elderly Care, Rehabilitation
Digital Healthcare :: Telemedicine, HealthTech, Electronic Medical Records
Clinical Research :: Clinical Trials, Contract Research Organisations
Healthcare Services :: Hospital Management, Medical Billing, Medical Tourism
Laboratory Services :: Research Laboratories, Medical Laboratories
Veterinary Healthcare :: Veterinary Clinics, Animal Hospitals, Animal Pharmaceuticals

# Education, Training & EdTech
School Education :: Pre-School, Primary, Secondary, Senior Secondary
Higher Education :: Colleges, Universities, Professional Institutes
Competitive Examination :: Government Exam Coaching, Entrance Exam Coaching
Professional Education :: CA, CS, CMA, Law, Medical, Engineering
Technical Education :: IT Training, Software Training, Engineering Skills
Vocational Education :: Industrial Training, Trade Skills, Technical Trades
Corporate Training :: Leadership, Management, Technical Training
Online Education :: E-Learning, Online Courses, Virtual Classrooms
Educational Technology :: Learning Management Systems, Assessment Platforms
Educational Content :: Books, Digital Content, Test Preparation Material
Language Education :: English, Foreign Languages, Communication Skills
Research & Development :: Academic Research, Educational Research
Educational Services :: Student Counselling, Admissions, Study Abroad

# Retail & E-Commerce
Grocery Retail :: Supermarkets, Hypermarkets, Convenience Stores
Food Retail :: Fresh Produce, Meat, Seafood, Bakery Retail
Fashion Retail :: Clothing, Footwear, Accessories
Electronics Retail :: Mobiles, Computers, Home Appliances
Furniture Retail :: Home Furniture, Office Furniture
Beauty Retail :: Cosmetics, Skincare, Personal Care
Luxury Retail :: Luxury Fashion, Watches, Jewellery
Pharmaceutical Retail :: Pharmacies, Medical Stores
Automotive Retail :: Car Dealers, Two-Wheeler Dealers, Spare Parts
E-Commerce :: General Marketplaces, Vertical Marketplaces
D2C Retail :: Direct-to-Consumer Brands, Online-First Brands
Wholesale Retail :: Cash-and-Carry, Bulk Retail
Home Improvement :: Hardware, Paints, Sanitaryware, Building Supplies
Specialty Retail :: Books, Toys, Sports Goods, Musical Instruments
Second-Hand Retail :: Used Electronics, Used Vehicles, Pre-Owned Fashion
Retail Technology :: POS Systems, Retail Analytics, Inventory Software

# Wholesale, Distribution & International Trade
FMCG Distribution :: Food, Beverages, Household Products
Pharmaceutical Distribution :: Medicines, Medical Supplies
Industrial Distribution :: Machinery, Equipment, Industrial Components
Electronics Distribution :: Consumer Electronics, Electronic Components
Agricultural Distribution :: Seeds, Fertilizers, Farm Equipment
Construction Distribution :: Cement, Steel, Tiles, Hardware
Automotive Distribution :: Vehicles, Spare Parts, Accessories
Import & Export :: General Importers, General Exporters
Commodity Trading :: Metals, Energy, Agricultural Commodities
Chemical Trading :: Industrial Chemicals, Specialty Chemicals
Textile Trading :: Fabrics, Garments, Raw Materials
B2B Trading :: Industrial Procurement, Wholesale Marketplaces
International Sourcing :: Global Procurement, Vendor Management
Trading Platforms :: B2B Marketplaces, Digital Trade Platforms

# Transportation, Logistics & Supply Chain
Road Transportation :: Passenger Transport, Commercial Transport
Trucking :: Full Truckload, Less-than-Truckload
Rail Transportation :: Passenger Rail, Freight Rail
Aviation :: Passenger Airlines, Cargo Airlines
Maritime :: Shipping, Container Shipping, Bulk Shipping
Port Operations :: Container Terminals, Cargo Handling
Warehousing :: General Warehousing, Cold Storage, Bonded Warehousing
Courier Services :: Domestic Courier, International Courier
Express Delivery :: Same-Day Delivery, Next-Day Delivery
Last-Mile Logistics :: E-Commerce Delivery, Hyperlocal Delivery
Freight Forwarding :: Air Freight, Ocean Freight, Land Freight
Supply Chain :: Supply Chain Consulting, Planning, Procurement
Logistics Technology :: Transportation Management Systems, Warehouse Management Systems
Fleet Management :: Vehicle Tracking, Fleet Operations
Cold Chain :: Pharmaceutical Cold Chain, Food Cold Chain
Moving Services :: Household Relocation, Corporate Relocation
Public Transportation :: Bus Services, Metro, Taxi, Ride-Hailing

# Automotive & Mobility
Passenger Vehicles :: Cars, SUVs, Hatchbacks, Luxury Cars
Commercial Vehicles :: Trucks, Buses, Vans
Two-Wheelers :: Motorcycles, Scooters, Electric Scooters
Three-Wheelers :: Auto-Rickshaws, Commercial Three-Wheelers
Electric Mobility :: Electric Cars, Electric Buses, Electric Two-Wheelers
Automotive Components :: Engines, Brakes, Transmissions, Suspension
Automotive Electronics :: Infotainment, Sensors, ADAS
Vehicle Dealerships :: New Vehicles, Used Vehicles
Vehicle Rental :: Car Rental, Commercial Vehicle Rental
Vehicle Leasing :: Corporate Leasing, Personal Leasing
Automotive Aftermarket :: Spare Parts, Accessories, Tyres
Vehicle Maintenance :: Repair, Servicing, Diagnostics
Automotive Finance :: Vehicle Loans, Leasing Finance
Automotive Insurance :: Motor Insurance, Fleet Insurance
Mobility Technology :: Autonomous Driving, Connected Vehicles
Charging Infrastructure :: EV Charging Stations, Battery Swapping

# Hospitality, Tourism & Travel
Hotels :: Luxury Hotels, Business Hotels, Budget Hotels
Resorts :: Beach Resorts, Mountain Resorts, Wellness Resorts
Accommodation :: Hostels, Guest Houses, Homestays
Restaurants :: Fine Dining, Casual Dining, Specialty Restaurants
Quick Service Restaurants :: Fast Food, Food Chains
Cafes :: Coffee Shops, Tea Houses, Bakeries
Catering :: Corporate Catering, Wedding Catering, Institutional Catering
Travel Agencies :: Domestic Travel, International Travel
Tour Operators :: Adventure Tours, Group Tours, Luxury Tours
Airlines :: Domestic Airlines, International Airlines
Cruise Tourism :: Ocean Cruises, River Cruises
Tourism Services :: Medical Tourism, Religious Tourism, Eco-Tourism
Travel Technology :: Online Travel Agencies, Hotel Booking Platforms
Corporate Travel :: Business Travel Management, MICE
Holiday Rentals :: Vacation Homes, Short-Term Rentals
Hospitality Management :: Hotel Operations, Resort Management

# Food & Beverage Services
Food Processing :: Meat Processing, Seafood Processing, Fruit Processing
Packaged Food :: Snacks, Ready-to-Eat, Frozen Foods
Bakery Products :: Bread, Cakes, Biscuits, Pastries
Dairy Products :: Milk, Cheese, Butter, Ice Cream
Beverages :: Juices, Soft Drinks, Bottled Water
Tea & Coffee :: Tea Production, Coffee Roasting, Coffee Distribution
Alcoholic Beverages :: Beer, Wine, Spirits
Food Ingredients :: Flavours, Preservatives, Food Additives
Food Service :: Restaurants, Cafeterias, Institutional Food
Cloud Kitchens :: Delivery-Only Kitchens, Multi-Brand Kitchens
Food Delivery :: Online Food Delivery, Restaurant Aggregation
Food Technology :: Food Innovation, Alternative Proteins, Food Automation
Food Safety :: Testing, Inspection, Certification
Agricultural Food Supply :: Grain Processing, Food Storage, Food Procurement

# Media, Entertainment, Advertising & Publishing
Film Production :: Feature Films, Short Films, Documentary Films
Television :: TV Production, Broadcasting, Television Networks
OTT :: Video Streaming, Subscription Streaming
Music :: Music Production, Recording, Distribution
Radio :: FM Radio, Digital Radio
Publishing :: Books, Magazines, Newspapers
Digital Publishing :: Online News, Blogs, Digital Magazines
Advertising :: Digital Advertising, TV Advertising, Print Advertising
Marketing :: Performance Marketing, Affiliate Marketing, Content Marketing
Public Relations :: Corporate PR, Media Relations, Crisis Communications
Creative Agencies :: Branding, Graphic Design, Creative Production
Gaming :: Game Development, Game Publishing, Mobile Gaming
Esports :: Esports Teams, Tournament Management
Animation :: 2D Animation, 3D Animation, VFX
Photography :: Commercial Photography, Product Photography
Influencer Economy :: Influencer Management, Creator Platforms
Events & Entertainment :: Live Concerts, Festivals, Entertainment Shows
Sports Media :: Sports Broadcasting, Sports Journalism

# Professional & Business Services
Management Consulting :: Strategy Consulting, Operations Consulting
IT Consulting :: Technology Consulting, Digital Transformation
Legal Services :: Corporate Law, Litigation, Intellectual Property
Accounting :: Bookkeeping, Financial Accounting
Auditing :: Internal Audit, Statutory Audit, Forensic Audit
Taxation :: Corporate Tax, International Tax, GST Consulting
Human Resources :: HR Consulting, HR Operations, HR Technology
Recruitment :: Permanent Staffing, Executive Search, Contract Staffing
Outsourcing :: BPO, KPO, LPO, RPO
Business Process Services :: Finance Operations, HR Operations, Customer Support
Engineering Consulting :: Civil, Mechanical, Electrical, Industrial Consulting
Market Research :: Consumer Research, Industry Research, Competitive Intelligence
Corporate Advisory :: Business Valuation, M&A Advisory, Restructuring
Compliance :: Regulatory Compliance, Risk Management, Governance
Secretarial Services :: Company Secretarial, Corporate Filings
Procurement Consulting :: Strategic Sourcing, Vendor Management
Design Services :: Product Design, Industrial Design, UX/UI Design
Translation Services :: Language Translation, Interpretation, Localization
Training Services :: Corporate Learning, Executive Development
Business Support :: Virtual Assistance, Administrative Support

# Defence, Aerospace & Space Technology
Defence Equipment :: Military Vehicles, Weapons Systems
Defence Electronics :: Radar, Sonar, Communication Systems
Aerospace :: Aircraft Manufacturing, Aircraft Components
Aviation Technology :: Flight Systems, Avionics, Navigation
Space Technology :: Launch Vehicles, Spacecraft, Space Systems
Satellite Technology :: Satellite Manufacturing, Ground Stations
Defence Software :: Military Software, Command & Control
Cyber Defence :: Military Cybersecurity, Threat Intelligence
Military Services :: Defence Logistics, Maintenance, Training
Private Security :: Security Guards, Corporate Security
Security Technology :: Access Control, CCTV, Alarm Systems
Border Security :: Screening, Detection, Surveillance
Space Services :: Satellite Imaging, Earth Observation, Space Data

# Chemicals, Materials & Industrial Solutions
Basic Chemicals :: Organic Chemicals, Inorganic Chemicals
Specialty Chemicals :: Performance Chemicals, Electronic Chemicals
Petrochemicals :: Polymers, Resins, Synthetic Fibres
Agrochemicals :: Pesticides, Herbicides, Fungicides
Fertilizers :: Nitrogen, Phosphate, Potash Fertilizers
Industrial Gases :: Oxygen, Nitrogen, Hydrogen, Argon
Paints & Coatings :: Decorative Paints, Industrial Coatings
Adhesives :: Industrial Adhesives, Sealants
Polymers :: Plastics, Elastomers, Thermoplastics
Advanced Materials :: Carbon Fibre, Graphene, Nanomaterials
Composites :: Fibre-Reinforced Materials, Composite Components
Industrial Ceramics :: Technical Ceramics, Refractory Materials
Battery Materials :: Cathode Materials, Anode Materials, Electrolytes
Surface Treatment :: Electroplating, Galvanizing, Metal Finishing
Material Testing :: Laboratory Testing, Quality Inspection

# Utilities, Environmental & Waste Management
Water Utilities :: Water Supply, Water Distribution
Water Treatment :: Filtration, Desalination, Purification
Wastewater :: Sewage Treatment, Industrial Wastewater
Solid Waste :: Municipal Waste, Commercial Waste
Recycling :: Plastic, Paper, Metal, Glass Recycling
Hazardous Waste :: Industrial Hazardous Waste, Medical Waste
E-Waste :: Electronics Recycling, Battery Recycling
Environmental Consulting :: Environmental Impact Assessment, Auditing
Pollution Control :: Air Pollution, Water Pollution, Noise Control
Renewable Waste :: Waste-to-Energy, Biogas
Environmental Technology :: Carbon Capture, Emissions Monitoring
Carbon Services :: Carbon Credits, Carbon Accounting
Utility Infrastructure :: Electricity, Gas, Water Distribution
Smart Infrastructure :: Smart Meters, Smart Grids, Smart Water Systems

# Fashion, Lifestyle, Luxury & Personal Care
Fashion :: Men's Wear, Women's Wear, Children's Wear
Luxury Fashion :: Designer Clothing, Haute Couture
Footwear :: Sports Shoes, Formal Shoes, Casual Shoes
Leather Goods :: Bags, Wallets, Belts
Jewellery :: Gold, Silver, Diamond, Fashion Jewellery
Watches :: Luxury Watches, Smartwatches
Cosmetics :: Makeup, Beauty Products
Skincare :: Facial Care, Body Care, Sunscreen
Haircare :: Shampoos, Conditioners, Hair Styling
Personal Hygiene :: Oral Care, Bath Products, Hygiene Products
Fragrances :: Perfumes, Deodorants, Essential Oils
Lifestyle Products :: Home Decor, Accessories, Travel Products
Luxury Goods :: Premium Lifestyle, Collectibles, Luxury Accessories
Fashion Technology :: Fashion Platforms, Digital Fitting, Textile Innovation

# Sports, Fitness, Recreation & Wellness
Professional Sports :: Football, Cricket, Basketball, Tennis
Sports Organisations :: Leagues, Federations, Associations
Sports Clubs :: Football Clubs, Cricket Clubs, Athletic Clubs
Sports Facilities :: Stadiums, Sports Complexes, Training Centres
Fitness :: Gyms, Fitness Studios, Personal Training
Yoga & Meditation :: Yoga Centres, Meditation Centres
Sports Equipment :: Fitness Equipment, Sports Gear
Sportswear :: Athletic Clothing, Sports Footwear
Sports Technology :: Performance Analytics, Sports Software
Sports Management :: Athlete Management, Sports Consulting
Recreation :: Amusement Parks, Adventure Parks, Recreation Centres
Outdoor Activities :: Camping, Trekking, Adventure Tourism
Wellness Services :: Spa, Massage, Holistic Wellness
Gaming & Recreation :: Indoor Games, Recreational Gaming Centres

# Social Services, NGOs & Development Organisations
Charitable Organisations :: Public Charities, Philanthropic Foundations
Social Development :: Rural Development, Urban Development
Education NGOs :: Literacy, Education Access, Scholarships
Healthcare NGOs :: Public Health, Medical Assistance
Environmental NGOs :: Conservation, Climate Action, Wildlife Protection
Humanitarian Services :: Disaster Relief, Emergency Assistance
Community Development :: Community Welfare, Local Development
Poverty Alleviation :: Livelihood Development, Financial Inclusion
Child Welfare :: Child Protection, Child Education
Elderly Care :: Senior Citizen Support, Assisted Living
Disability Services :: Accessibility, Rehabilitation, Inclusion
Social Enterprises :: Employment Generation, Social Innovation
Development Finance :: Impact Investment, Development Lending
Research Organisations :: Social Research, Policy Research

# Emerging, Advanced & Cross-Industry Technologies
Robotics :: Industrial Robotics, Service Robotics, Humanoid Robotics
Autonomous Systems :: Autonomous Vehicles, Autonomous Drones
Quantum Technology :: Quantum Computing, Quantum Communication
Space Commercialisation :: Space Tourism, Space Mining, Space Manufacturing
Extended Reality :: Virtual Reality, Augmented Reality, Mixed Reality
Metaverse :: Virtual Worlds, Digital Assets, Virtual Commerce
3D Printing :: Industrial 3D Printing, Medical 3D Printing
Advanced Biotechnology :: Synthetic Biology, Bioinformatics
Genetic Technology :: Gene Editing, Genomics
Climate Technology :: Carbon Removal, Climate Modelling
Smart Cities :: Intelligent Infrastructure, Urban Technology
Internet of Things :: Industrial IoT, Consumer IoT, Connected Devices
Digital Identity :: Identity Verification, Digital Credentials
Advanced Computing :: Edge Computing, Neuromorphic Computing
Human-Machine Technology :: Brain-Computer Interfaces, Assistive Technology
Advanced Manufacturing :: Industry 4.0, Smart Factories, Digital Manufacturing

# Personal, Household & Local Services
Domestic Services :: Housekeeping, Domestic Staffing, Home Cleaning
Home Maintenance :: Plumbing, Electrical Repairs, Carpentry
Repair Services :: Electronics Repair, Appliance Repair, Vehicle Repair
Beauty Services :: Salons, Barbershops, Beauty Parlours
Laundry Services :: Dry Cleaning, Commercial Laundry
Childcare :: Daycare, Childcare Centres, Babysitting
Elderly Services :: Home Assistance, Senior Care
Pet Services :: Pet Grooming, Pet Boarding, Pet Training
Personal Services :: Personal Shopping, Concierge Services
Funeral Services :: Funeral Homes, Cremation Services, Memorial Services

# Government, Public Administration & Public Infrastructure
Government Administration :: Central Government, State Government, Local Government
Public Finance :: Treasury, Tax Administration, Public Revenue
Public Safety :: Police, Fire Services, Emergency Services
Public Infrastructure :: Roads, Public Transport, Public Utilities
Regulatory Bodies :: Financial Regulators, Industry Regulators
Public Education :: Government Schools, Public Universities
Public Healthcare :: Government Hospitals, Public Health Centres
Defence Administration :: Defence Departments, Military Administration
`;

/** [{ name, industries: [{ name, subs: [name] }] }] in the order of the list. */
function parseStandardList(raw = RAW) {
  const sectors = [];
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (line.startsWith('# ')) { sectors.push({ name: line.slice(2).trim(), industries: [] }); continue; }
    const [industry, subs = ''] = line.split('::').map((x) => x.trim());
    if (!industry || !sectors.length) continue;
    sectors[sectors.length - 1].industries.push({ name: industry, subs: [...new Set(subs.split(',').map((x) => x.trim()).filter(Boolean))] });
  }
  return sectors;
}

module.exports = { parseStandardList };
