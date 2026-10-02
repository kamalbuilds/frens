// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallStake, IPerplExchange, IERC20} from "../src/CallStake.sol";

interface IERC20Full is IERC20 {
    function approve(address s, uint256 a) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// Against Perpl's real testnet Exchange: the struct layouts decode a real resting take-profit, and the stake honours
/// the 0.5% minimum distance from the live mark. Perpl recycles order ids, so the test reads whatever order 138 is
/// now and follows it rather than assuming its owner.
contract CallStakeForkTest is Test {
    IPerplExchange constant EX = IPerplExchange(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    IERC20Full constant AUSD = IERC20Full(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
    address constant BO = 0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244;
    address constant CY = 0x4eb664F1E9b7c812dDFBC4118326FE3e23b7DceD;
    uint256 constant PERP = 16;
    uint256 constant ORDER = 138; // cy's call on bo's short since accept 0x76241d17

    function test_realTakeProfitAgainstTheLiveMark() public {
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC_URL", string("https://testnet-rpc.monad.xyz")));
        CallStake cs = new CallStake(EX, AUSD);
        IPerplExchange.OrderV2 memory o = EX.getOrderV2(PERP, ORDER);
        assertTrue(o.orderType == 2 || o.orderType == 3, "a close");
        assertGt(o.lotLNS, 0, "still resting");
        assertEq(EX.getAccountByAddr(BO).accountId, o.accountId, "bo owns it");

        IPerplExchange.PerpetualInfoV2 memory info = EX.getPerpetualInfoV2(PERP);
        uint256 tp = uint256(o.priceONS) + info.basePricePNS;
        uint256 gap = (info.markPNS * cs.MIN_DISTANCE_BPS()) / 10_000;
        bool tooClose = o.orderType == 2 ? tp < info.markPNS + gap : tp + gap > info.markPNS;

        vm.startPrank(BO);
        AUSD.approve(address(cs), 1e6);
        if (tooClose) vm.expectRevert(abi.encodeWithSelector(CallStake.TooCloseToMark.selector, info.markPNS, tp));
        cs.stake(bytes32(uint256(1)), CY, 1e6, PERP, ORDER, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        if (tooClose) return;

        (,,,,,,, uint256 staked) = cs.stakes(bytes32(uint256(1)));
        assertEq(staked, tp, "TP read from the order");
        info.markPNS = tp;
        vm.mockCall(address(EX), abi.encodeWithSelector(IPerplExchange.getPerpetualInfoV2.selector, PERP), abi.encode(info));
        uint256 before = AUSD.balanceOf(CY);
        cs.release(bytes32(uint256(1)));
        assertEq(AUSD.balanceOf(CY) - before, 1e6, "caller paid exactly the stake");
    }
}
