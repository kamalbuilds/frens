// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallStake, IPerplExchange, IERC20} from "../src/CallStake.sol";

interface IERC20Full is IERC20 {
    function approve(address s, uint256 a) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// Against Perpl's real testnet Exchange: proves the struct layouts decode a real resting take-profit.
contract CallStakeForkTest is Test {
    IPerplExchange constant EX = IPerplExchange(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    IERC20Full constant AUSD = IERC20Full(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
    address constant DEE = 0x073f475a00ec54172f38864b12b32e7f481607e9;
    address constant CY = 0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD;
    uint256 constant PERP = 16;
    uint256 constant ORDER = 138; // cy's call on dee's short, accepted in tx 0x850e07e6

    function test_realTakeProfitStakesAndPaysOnlyWhenTheMarkCrosses() public {
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC_URL", string("https://testnet-rpc.monad.xyz")));
        CallStake cs = new CallStake(EX, AUSD);
        IPerplExchange.OrderV2 memory o = EX.getOrderV2(PERP, ORDER);
        assertEq(o.orderType, 3, "close-short");
        assertGt(o.lotLNS, 0, "still resting");
        assertEq(EX.getAccountByAddr(DEE).accountId, o.accountId, "dee owns it");

        vm.startPrank(DEE);
        AUSD.approve(address(cs), 1e6);
        cs.stake(bytes32(uint256(1)), CY, 1e6, PERP, ORDER, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        (,,,,,, , uint256 tp) = cs.stakes(bytes32(uint256(1)));
        assertEq(tp, 817_650, "TP 81,765.0 at priceDecimals 1");

        IPerplExchange.PerpetualInfoV2 memory info = EX.getPerpetualInfoV2(PERP);
        assertGt(info.markPNS, tp, "live mark is above a short's TP");
        vm.expectRevert(abi.encodeWithSelector(CallStake.NotHit.selector, info.markPNS, tp));
        cs.release(bytes32(uint256(1)));

        info.markPNS = tp;
        vm.mockCall(address(EX), abi.encodeWithSelector(IPerplExchange.getPerpetualInfoV2.selector, PERP), abi.encode(info));
        uint256 before = AUSD.balanceOf(CY);
        cs.release(bytes32(uint256(1)));
        assertEq(AUSD.balanceOf(CY) - before, 1e6, "caller paid exactly the stake");
    }
}
