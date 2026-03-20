/** Types generated for queries found in "src/sql/werewolf_wallet_mapping.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type NumberOrString = number | string;

/** 'UpsertWalletMapping' parameters type */
export interface IUpsertWalletMappingParams {
  evm_address: string;
  proxy_midnight_address: string;
  registered_block: NumberOrString;
}

/** 'UpsertWalletMapping' return type */
export type IUpsertWalletMappingResult = void;

/** 'UpsertWalletMapping' query type */
export interface IUpsertWalletMappingQuery {
  params: IUpsertWalletMappingParams;
  result: IUpsertWalletMappingResult;
}

const upsertWalletMappingIR: any = {"usedParamSet":{"evm_address":true,"proxy_midnight_address":true,"registered_block":true},"params":[{"name":"evm_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":100,"b":112}]},{"name":"proxy_midnight_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":115,"b":138}]},{"name":"registered_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":141,"b":158}]}],"statement":"INSERT INTO werewolf_wallet_mapping (evm_address, proxy_midnight_address, registered_block)\nVALUES (:evm_address!, :proxy_midnight_address!, :registered_block!)\nON CONFLICT (evm_address) DO NOTHING"};

/**
 * Query generated from SQL:
 * ```
 * INSERT INTO werewolf_wallet_mapping (evm_address, proxy_midnight_address, registered_block)
 * VALUES (:evm_address!, :proxy_midnight_address!, :registered_block!)
 * ON CONFLICT (evm_address) DO NOTHING
 * ```
 */
export const upsertWalletMapping = new PreparedQuery<IUpsertWalletMappingParams,IUpsertWalletMappingResult>(upsertWalletMappingIR);


/** 'GetWalletMappingByEvm' parameters type */
export interface IGetWalletMappingByEvmParams {
  evm_address: string;
}

/** 'GetWalletMappingByEvm' return type */
export interface IGetWalletMappingByEvmResult {
  claimed_block: string | null;
  evm_address: string;
  proxy_midnight_address: string;
  real_midnight_address: string | null;
}

/** 'GetWalletMappingByEvm' query type */
export interface IGetWalletMappingByEvmQuery {
  params: IGetWalletMappingByEvmParams;
  result: IGetWalletMappingByEvmResult;
}

const getWalletMappingByEvmIR: any = {"usedParamSet":{"evm_address":true},"params":[{"name":"evm_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":130,"b":142}]}],"statement":"SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block\nFROM werewolf_wallet_mapping\nWHERE evm_address = :evm_address!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block
 * FROM werewolf_wallet_mapping
 * WHERE evm_address = :evm_address!
 * ```
 */
export const getWalletMappingByEvm = new PreparedQuery<IGetWalletMappingByEvmParams,IGetWalletMappingByEvmResult>(getWalletMappingByEvmIR);


/** 'GetWalletMappingByProxy' parameters type */
export interface IGetWalletMappingByProxyParams {
  proxy_midnight_address: string;
}

/** 'GetWalletMappingByProxy' return type */
export interface IGetWalletMappingByProxyResult {
  claimed_block: string | null;
  evm_address: string;
  proxy_midnight_address: string;
  real_midnight_address: string | null;
}

/** 'GetWalletMappingByProxy' query type */
export interface IGetWalletMappingByProxyQuery {
  params: IGetWalletMappingByProxyParams;
  result: IGetWalletMappingByProxyResult;
}

const getWalletMappingByProxyIR: any = {"usedParamSet":{"proxy_midnight_address":true},"params":[{"name":"proxy_midnight_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":141,"b":164}]}],"statement":"SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block\nFROM werewolf_wallet_mapping\nWHERE proxy_midnight_address = :proxy_midnight_address!"};

/**
 * Query generated from SQL:
 * ```
 * SELECT evm_address, proxy_midnight_address, real_midnight_address, claimed_block
 * FROM werewolf_wallet_mapping
 * WHERE proxy_midnight_address = :proxy_midnight_address!
 * ```
 */
export const getWalletMappingByProxy = new PreparedQuery<IGetWalletMappingByProxyParams,IGetWalletMappingByProxyResult>(getWalletMappingByProxyIR);


/** 'ClaimRealWallet' parameters type */
export interface IClaimRealWalletParams {
  claimed_block: NumberOrString;
  evm_address: string;
  real_midnight_address: string;
}

/** 'ClaimRealWallet' return type */
export type IClaimRealWalletResult = void;

/** 'ClaimRealWallet' query type */
export interface IClaimRealWalletQuery {
  params: IClaimRealWalletParams;
  result: IClaimRealWalletResult;
}

const claimRealWalletIR: any = {"usedParamSet":{"real_midnight_address":true,"claimed_block":true,"evm_address":true},"params":[{"name":"real_midnight_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":81}]},{"name":"claimed_block","required":true,"transform":{"type":"scalar"},"locs":[{"a":113,"b":127}]},{"name":"evm_address","required":true,"transform":{"type":"scalar"},"locs":[{"a":149,"b":161}]}],"statement":"UPDATE werewolf_wallet_mapping\nSET real_midnight_address = :real_midnight_address!,\n    claimed_block          = :claimed_block!\nWHERE evm_address = :evm_address!\n  AND real_midnight_address IS NULL"};

/**
 * Query generated from SQL:
 * ```
 * UPDATE werewolf_wallet_mapping
 * SET real_midnight_address = :real_midnight_address!,
 *     claimed_block          = :claimed_block!
 * WHERE evm_address = :evm_address!
 *   AND real_midnight_address IS NULL
 * ```
 */
export const claimRealWallet = new PreparedQuery<IClaimRealWalletParams,IClaimRealWalletResult>(claimRealWalletIR);


