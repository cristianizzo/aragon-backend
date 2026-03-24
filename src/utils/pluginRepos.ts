/**
 * Maps known PluginRepo addresses to plugin interface types.
 * These are the RepoProxy addresses from Aragon's contract deployments.
 * All addresses are lowercased for case-insensitive matching.
 */

type PluginType =
  | "multisig"
  | "tokenVoting"
  | "admin"
  | "addresslistVoting"
  | "spp"
  | "lockToVote"
  | "gauge"
  | "capitalDistributor"
  | "router"
  | "claimer";

const PLUGIN_REPO_MAP: Record<string, PluginType> = {};

function addRepo(address: string, type: PluginType) {
  PLUGIN_REPO_MAP[address.toLowerCase()] = type;
}

// --- Multisig ---
addRepo("0x8c278e37D0817210E18A7958524b7D0a1fAA6F7b", "multisig"); // Ethereum v1.0.0 + v1.3.0
addRepo("0x9e7956C8758470dE159481e5DD0d08F8B59217A2", "multisig"); // Sepolia
addRepo("0x5A5035E7E8aeff220540F383a9cf8c35929bcF31", "multisig"); // Polygon
addRepo("0x7553E6Fb020c5740768cF289e603770AA09b7aE2", "multisig"); // Arbitrum
addRepo("0xcDC4b0BC63AEfFf3a7826A19D101406C6322A585", "multisig"); // Base
addRepo("0x83f88d380073c8F929fAB649F3d016649c101D3A", "multisig"); // zkSync

// --- TokenVoting ---
addRepo("0xb7401cD221ceAFC54093168B814Cc3d42579287f", "tokenVoting"); // Ethereum v1.0.0 + v1.3.0
addRepo("0x424F4cA6FA9c24C03f2396DF0E96057eD11CF7dF", "tokenVoting"); // Sepolia
addRepo("0xae67aea0B830ed4504B36670B5Fa70c5C386Bb58", "tokenVoting"); // Polygon
addRepo("0x1AeD2BEb470aeFD65B43f905Bd5371b1E4749d18", "tokenVoting"); // Arbitrum
addRepo("0x2532570DcFb749A7F976136CC05648ef2a0f60b0", "tokenVoting"); // Base
addRepo("0xE8F4C59f83CeE31A867E61c9959533A6e95ebCB3", "tokenVoting"); // zkSync

// --- Admin ---
addRepo("0xA4371a239D08bfBA6E8894eccf8466C6323A52C3", "admin"); // Ethereum
addRepo("0x152c9E28995E418870b85cbbc0AEE4e53020edb2", "admin"); // Sepolia
addRepo("0x7fF570473d0876db16A59e8F04EE7F17Ab117309", "admin"); // Polygon
addRepo("0x326A2aee6A8eE78D79E7E956DE60C6E452f76a8e", "admin"); // Arbitrum
addRepo("0x212eF339C77B3390599caB4D46222D79fAabcb5c", "admin"); // Base

// --- AddresslistVoting ---
addRepo("0xC207767d8A7a28019AFFAEAe6698F84B5526EbD7", "addresslistVoting"); // Ethereum
addRepo("0xdfA1fBeC1Cad92597101A4f4A18e1340c5eA55C1", "addresslistVoting"); // Sepolia
addRepo("0x641DdEdc2139d9948e8dcC936C1Ab2314D9181E6", "addresslistVoting"); // Polygon
addRepo("0xf415FF95166EF5D365fFB3bc6d1701f9e9ed7Df7", "addresslistVoting"); // Arbitrum
addRepo("0x0A5387021B2722E983842fA701D0BaD8B9279fE2", "addresslistVoting"); // Base
addRepo("0x5BC82E4473e01f57716FC7f1361d424B54968e17", "addresslistVoting"); // zkSync

// --- StagedProposalProcessor ---
addRepo("0xE67b8E026d190876704292442A38163Ce6945d6b", "spp"); // Ethereum
addRepo("0x421FF506E4DC17356965565688D62b55Bf2bf0a5", "spp"); // Ethereum (alt)
addRepo("0xda62D32C14E8CA78958d6fdC0142A575b0cd6Ad4", "spp"); // Sepolia
addRepo("0x9C61D4266815bdd32f4D2885B6CF5763F449050B", "spp"); // Sepolia (alt)
addRepo("0xc36fE143bd829a80df458Bd9ab52299Df985DC6F", "spp"); // Polygon
addRepo("0xe3B00403Cd8cBee7af01961c25220289a4Cc5753", "spp"); // Arbitrum
addRepo("0x3C13098D4e2FE9aCb2fCEb3EE4fBBe33405eD39D", "spp"); // Base
addRepo("0xE294451cB4B7aA4a8136dA6474b8b4C6C5a69973", "spp"); // zkSync

// --- LockToVote ---
addRepo("0x0f4FBD2951Db08B45dE16e7519699159aE1b4bb7", "lockToVote"); // Ethereum
addRepo("0x4E9c4d138f5E3B5D28b3F0e66749899738AEf8a2", "lockToVote"); // Ethereum (lock-to-vote)
addRepo("0x70927fA8b84777c79A9b9CC011BfbE08B04eB1e4", "lockToVote"); // Ethereum (lock-to-vote-plugin)
addRepo("0x499f7c3E8778D07BbBdc434dF06a985e54d7ed35", "lockToVote"); // Sepolia
addRepo("0x0D0ce1B8569d400b98556967545A29615b66Cd0C", "lockToVote"); // Sepolia (lock-to-vote)
addRepo("0x326D2b4cC92281D6fF757D79af98bE255BA45cE1", "lockToVote"); // Polygon
addRepo("0xd883239CdA10a48484D0a7EEc8fD0A80e182fFA4", "lockToVote"); // Polygon (lock-to-vote)
addRepo("0xe92eF55cCbB3ac48f54f2FcDC4c49379CB01C57F", "lockToVote"); // Arbitrum
addRepo("0xe119b829A80F1dfb4EBfe778D57f3F90F3dcbDAc", "lockToVote"); // Arbitrum (lock-to-vote)
addRepo("0x05ECA5ab78493Bf812052B0211a206BCBA03471B", "lockToVote"); // Base
addRepo("0x9Bb1234b8e163412977C25E6aA7893eFbC3c884F", "lockToVote"); // Base (lock-to-vote)
addRepo("0xd0f0Bc285F4D27417ECd8C027BB6746690ba72b2", "lockToVote"); // zkSync

// --- Gauge Voter ---
addRepo("0x5F97Ee2E3441FAB942034881e2b833C6FE4F282e", "gauge"); // Base (peaq)
addRepo("0x7BEf4dFCAB5a1B8C9A02CD032ddD4629b767D34c", "gauge"); // Base (peaq-simple)
addRepo("0x570C25470827e35C698F5de2a1eb0B3987dFc908", "gauge"); // Base (ynd)

// --- Capital Distributor ---
addRepo("0x09563BB7D619B4cdd7416e5178eaa9b0486845eE", "capitalDistributor"); // Ethereum
addRepo("0x9dd3f94E33b748b09081378d7Fd4dFfF4970b290", "capitalDistributor"); // Ethereum (cryptex)

// =============================================
// Sepolia test/dev repos (all chains)
// =============================================

// --- Sepolia: SPP ---
addRepo("0xA4c8950921A9A5aB48FA9509929EC1D8Ac055ee8", "spp");
addRepo("0x53EbCAE2Ff222D2749b8F1f4a0868383ab00Efa4", "spp");

// --- Sepolia: Gauge Voter ---
addRepo("0x26AF5b7f8e46ae0F6e020d3F2D3be41263FF4bd3", "gauge");
addRepo("0x9698eEffF8A37906e51FC88D59a9cE0Eee29EBa5", "gauge");
addRepo("0xb80079f378A2572aE3C5a9C3e6acf78b7435A65d", "gauge");
addRepo("0xa58b5A1FfAE1B3ACE5b3ab19d97Fd45B2926CC49", "gauge");
addRepo("0x6141072a70f9E5ab188f811F9bEEAf92cDFFcF51", "gauge");
addRepo("0x443868F6e94c5224817945FBDde849d7872E3A5F", "gauge");
addRepo("0xD7c0180107A8E82d160Ac8F09199e3f1Cc0b1ACb", "gauge");
addRepo("0xfA43B2FFDC5C86f7895ee82911C7e397780eE3C0", "gauge");
addRepo("0x89cca5dbCf404a3A0616030cA08B3e6DAC35185c", "gauge");
addRepo("0xf6505678ABCf8285D112b1463d8809E101464B30", "gauge");
addRepo("0x3feD9074B69a734DC970Ad099B619D0d47f5C431", "gauge");
addRepo("0x60Fb3E3c6Bd1B8308958f54f518728DF99237c15", "gauge");
addRepo("0x25AdC917Bb4a7806a87db308A79abD4Da3c04083", "gauge");
addRepo("0xFBd15B258a8980C10Cd03F2aB9Cdef60BB9aCA5F", "gauge");
addRepo("0x4a6b4a00608E185f131249EF1a797542AFC7B830", "gauge");
addRepo("0xB31c6a8d77ddd67544a510b705039ECeDD276dC6", "gauge");
addRepo("0x8b7bf29db6E5A3d966512D525262560459463BcD", "gauge");
addRepo("0x27f3C39672525875DEA35b9F30553A9398B23dbD", "gauge");
addRepo("0x38bF3B07974BC8F5D51EC2cA6B61164058b32853", "gauge");
addRepo("0xFc0BaF99A17aF86315f03c6c493a426aaD7dbC1F", "gauge");
addRepo("0x73Cf48126171b1c040C28182A3e8BCF90D1b1935", "gauge");
addRepo("0xaD6271c7f28e7542C9297d7Ff535D2BBb8ff68cD", "gauge");
addRepo("0x922e5B3Fde97CCBd9E4018EB9302b1A763411DAd", "gauge");
addRepo("0xA44A71A7cF6F24f1f9568B3Dcb6b8e93AA6cDbb6", "gauge");
addRepo("0x017E16B0802f7cd1F891193136Cf649975F6f522", "gauge");
addRepo("0x84093D69a07da362381413812B7baC1C8BA260DF", "gauge");
addRepo("0x6A51328e8002866d4D229D9e5E3Bfd2C12642264", "gauge");
addRepo("0xeB20686DD62e3cFcd4EB7f74B41a61D1360a8778", "gauge");
addRepo("0x06CD0cf6E1977483ec3fefdA0e43BcC56Ba45a52", "gauge");
addRepo("0xC39fa437D4Ab59cC462ceC911DD46edf21BFe111", "gauge");
addRepo("0xA044EF11d75992A0d133c711eC3174023FdF36d9", "gauge");
addRepo("0x66e13E51FCE52587E37e6f67326FceF4dD26DEEA", "gauge");
addRepo("0xC8804cda736e63Ce8C6E15cd5650E25A2BA27d4b", "gauge");
addRepo("0x9D82E086F4B5dC4daeDF9bfE2E8447f0b1147FaD", "gauge");
addRepo("0x31F55D3A9872A9Ce88788bbFF8c06c1eaae8DcF0", "gauge");
addRepo("0xe3AC0b2270443a1c2E3c129C6C30e9166Bd77293", "gauge");
addRepo("0x84E1e3C148024aeb611C3753786198Fb2427c365", "gauge");
addRepo("0x92791930260FaBB724F4Ecc45287f0aE09Ea6814", "gauge");
addRepo("0xa6823751040856C25CdB92D6DF6c26338dD02A84", "gauge");
addRepo("0x2e3aF5A9eF19b2851B5AD2D1dAB27dE5235Dd02d", "gauge");
addRepo("0x9Eec98E834aC536f9596Cfb74af79cB3EEDdb177", "gauge");
addRepo("0x890522983DD45d1381d9bf16a16ce3BcDaB8EE29", "gauge");
addRepo("0x0369a67135102762706cFdAdbd63aD207480533C", "gauge");

// --- Sepolia: Capital Distributor ---
addRepo("0xb58338509b67Fe4db15E95913a509eAdcd0a67ac", "capitalDistributor");
addRepo("0x9A282eaa15b9D3661F160f8E70A72815AEbae0a9", "capitalDistributor");
addRepo("0xBD6cC1AC023EcA5dE8788E5F71DAE675cB1F8F08", "capitalDistributor");
addRepo("0x905aaFE583407ab9315Ba71D8858B9D63284d519", "capitalDistributor");
addRepo("0xDF6F4d335F2b129819Edc02ff4cd95a805C46c92", "capitalDistributor");
addRepo("0x8C96Fbfb6e29E112F3aa050Ba66D314C6E63cA35", "capitalDistributor");
addRepo("0x3022c07c88Edb6400Ba84aD6C02faaC6bB13CB3C", "capitalDistributor");
addRepo("0x52E8bE93372C52D67859f804B37cF2feC3dab34C", "capitalDistributor");
addRepo("0x1E273D8c008FEE2B4b18A4f9D4e2a1E904826f3b", "capitalDistributor");
addRepo("0xB137B6CB02699AbA85c97265c533f51dFF187299", "capitalDistributor");
addRepo("0x95eC69d63bc0152656185A7A9CaA60962331aCE2", "capitalDistributor");
addRepo("0x9EAE85E3dCE55b9e8d8c0bC7236a6Dc05FAEA501", "capitalDistributor");
addRepo("0x2869F41B7fD18E3cCA5889Ca1fb82169Aa9A39B2", "capitalDistributor");
addRepo("0x15E3d83C171d34A8581D2807c2152e0aa883CD7b", "capitalDistributor");
addRepo("0x4c8c3877fa99F808CBA2543B44AE51dC753ABCBa", "capitalDistributor");
addRepo("0xF58d039927BaF5f6629B4277FD27dBDaa805130c", "capitalDistributor");
addRepo("0x06F3AF396EA6fB3Da44bB41effDa025a84925048", "capitalDistributor");
addRepo("0xB6c982eFFE95f4d8B7E45fa50D36a0fdfD7c7A39", "capitalDistributor");
addRepo("0xE3FaDF7bA81bbeeFE47215902cEAD215BD8757Ac", "capitalDistributor");
addRepo("0x320e9c6f5F6A1C0E6aaF7287f05Bde05E5c00E06", "capitalDistributor");
addRepo("0xe03d80A4864b71898ea3ab6E2A426D390897D627", "capitalDistributor");
addRepo("0x1B5E933A3499fe6d8C8A2ea75673D9e2c2F414de", "capitalDistributor");
addRepo("0xd1194aA4BB7dD899a544730B1CB41Adcd3a33D43", "capitalDistributor");

// --- Sepolia: LockToVote ---
addRepo("0x901a3dE3a63982dE312bc5870AcB36Cd26f7C8F5", "lockToVote");
addRepo("0xC9f0368832291cceD8Da55F3146ba45F42516466", "lockToVote");
addRepo("0x739b89170274889FA50B1490Fa8f6362D81A9E2B", "lockToVote");
addRepo("0xe346aD8acF8328F4B3296EFD073bf24dd099a7A1", "lockToVote");
addRepo("0x530eF57193D7d6C04f95FAC63fa7d70527Ebf3F0", "lockToVote");
addRepo("0xa6e1AE08bC718aBC40B3E00c71ddB8Ecb47120Dc", "lockToVote");
addRepo("0x63C801B187B3312550e19E5E7E36713a25cec267", "lockToVote");
addRepo("0x8e99664464D9538d734830E216E38695fC1f4d3a", "lockToVote");
addRepo("0xce3d328AE234eD9a0D5da174B40a29e31E88E8dc", "lockToVote");
addRepo("0x9e408c815E1438fF64Eb6B7EDFaE0Cc4F495523c", "lockToVote");
addRepo("0x9981d749ADA16931494c5534f13C180A3dF2D2AB", "lockToVote");
addRepo("0x46Cb89E67ED6b3cae2762b24e607b88D5b826848", "lockToVote");
addRepo("0x01df10dDBcf88C812912eEAac77EcC16B5bbE17f", "lockToVote");
addRepo("0x37c1B82DA9CBF74c2EDb1777a1875d5A74B09A04", "lockToVote");
addRepo("0x1165b246471fEd751d858C91a24c26Ed288AE022", "lockToVote");
addRepo("0xfCec5eF6F21F0C97A366699D4B1291Bc901afBC5", "lockToVote");

// --- Sepolia: Router ---
addRepo("0x985323bA031F640B52EC0505b1E84D3279dc54a5", "router");
addRepo("0x42718AB262073EFFB1AC6d538a4BD6717039d4b3", "router");
addRepo("0x9D42320720776eC56deB688928F0F575A730FdB4", "router");
addRepo("0x941c6E4FCb9e32248b3B6C8e24A4d4Ea6174C071", "router");
addRepo("0x3bb8928D5bd6B962E2c4c7Dbd16A7cE33956F1c9", "router");
addRepo("0xe6Ff1418fC4c6D03f4Fb42F2c2A48F44d472D48B", "router");
addRepo("0x918C92BcA068112ee294c46Ea7F96daa1414e6b8", "router");
addRepo("0x7802B2872db1402A639e8313055d31e2Ca7ddb7c", "router");
addRepo("0x2c8038484EB4813c6cfE0C37DD26fe80Cb3b1450", "router");
addRepo("0x7AE2AcF3437A55cf37fd58d6081b74cE0F821152", "router");
addRepo("0x56c3b53f3bA2dD907E67AdC7536480F81a886C35", "router");
addRepo("0x1bd5970DCEB7168c65b1A226ED71Fb632c3Def47", "router");
addRepo("0x94F59A8f5C61d28a8e893bdFD15252ADBf81E509", "router");
addRepo("0xA108158325E8B543E937B67325CCA17E4268BC60", "router");
addRepo("0x1E5938c1f2A42D46Ca10E5666110AEb58830db65", "router");
addRepo("0xb2dA3445C77251CfcA8C0EBcF8eeb3EdB63277DD", "router");
addRepo("0x4bC521AE26F41ee92A5D5D07B104fb467502a8Ee", "router");
addRepo("0x559BCFFA62bB13E44aAe86f3A83B9013fe73db79", "router");
addRepo("0xe6afcafb3de6703d685fFC193c99Bc2c0F694247", "router");
addRepo("0x1C6Cd9804153d3DE562CCd6c0917cd0F4fB5Ea09", "router");
addRepo("0x8275d02398393A30C239E85ab22C547E51d045c5", "router");
addRepo("0x26a3450365Ca27303652a32432C5749221b203F6", "router");
addRepo("0x9e53BF4A24F31F7462Dbc811A6B82216dc55E574", "router");

// --- Sepolia: Claimer ---
addRepo("0x71d769312A4eC1B6f418A88a6450BD39c58A1159", "claimer");
addRepo("0x70f636D481898E897FceDB182074eF61e05FbbD0", "claimer");
addRepo("0x62E06c49464f26303EA5F888C6A20372f5914c8f", "claimer");
addRepo("0xBc5aA149BAe7a8229eA407CBBD71f2091dfF8075", "claimer");
addRepo("0xb004A24a3a7340a83AB97E6d50E57Df348F46B75", "claimer");
addRepo("0x4082B49e69431A4253eEefF71130BA3d42e2674c", "claimer");
addRepo("0x237440E03441D0F0Ca6e8163595DA4bB8c1625A7", "claimer");
addRepo("0x25A04A7A4D447185A87e8C09C3BEd4188cd86d50", "claimer");
addRepo("0x60843407E78942e77aE4c8EEaA8107ffE92bc029", "claimer");
addRepo("0x295AA0c1a6b9282e50705A740FeF3ceAA71c7de3", "claimer");
addRepo("0x863616c49C048541d6D7e6627c1ac5b0C5097C4E", "claimer");

// --- Sepolia: zkSync LockToVote ---
addRepo("0xe56CBcFD89cdd5Abc42F081c9567A2C2d52580d3", "lockToVote");
addRepo("0x7A968405a1Ff873Ca3E35ff5eFce51ef2E35b9Cd", "lockToVote");

/**
 * Detect plugin type from pluginSetupRepo address.
 * Returns undefined for unknown repos (3rd party plugins).
 */
export function getPluginTypeFromRepo(repoAddress: string): PluginType | undefined {
  return PLUGIN_REPO_MAP[repoAddress.toLowerCase()];
}
