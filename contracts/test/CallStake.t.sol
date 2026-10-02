// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallStake, IPerplExchange, IERC20} from "../src/CallStake.sol";

contract Token {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract Exchange {
    IPerplExchange.OrderV2 internal order;
    uint256 internal mark;
    uint256 internal base;
    mapping(address => uint256) internal accountOf;
    function setOrder(uint32 acct, uint8 typ, uint24 priceONS, uint40 lots) external {
        order.accountId = acct; order.orderType = typ; order.priceONS = priceONS; order.lotLNS = lots;
    }
    function setMark(uint256 m) external { mark = m; }
    function setBase(uint256 b) external { base = b; }
    function setAccount(address a, uint256 id) external { accountOf[a] = id; }
    function getOrderV2(uint256, uint256) external view returns (IPerplExchange.OrderV2 memory) { return order; }
    function getPerpetualInfoV2(uint256) external view returns (IPerplExchange.PerpetualInfoV2 memory p) {
        p.markPNS = mark; p.basePricePNS = base;
    }
    function getAccountByAddr(address a) external view returns (IPerplExchange.AccountInfo memory i) { i.accountId = accountOf[a]; }
}

contract CallStakeTest is Test {
    Token token;
    Exchange ex;
    CallStake cs;
    address owner = address(0xA11CE);
    address caller = address(0xCA11);
    address stranger = address(0xBAD);
    bytes32 id = bytes32(uint256(0x1234));

    function setUp() public {
        token = new Token();
        ex = new Exchange();
        cs = new CallStake(IPerplExchange(address(ex)), IERC20(address(token)));
        ex.setAccount(owner, 7);
        ex.setBase(800_000);
        ex.setOrder(7, 2, 50_000, 100); // close-long TP at 850_000 PNS
        ex.setMark(840_000); // 1.19% below the TP, past the 0.5% minimum
        token.mint(owner, 1_000e6);
        vm.prank(owner);
        token.approve(address(cs), type(uint256).max);
    }

    function _stake() internal {
        vm.prank(owner);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_stakeReadsTpFromTheOrder() public {
        _stake();
        (address o, address c, uint96 amt,,, bool closeLong, CallStake.State st, uint256 tp) = cs.stakes(id);
        assertEq(o, owner); assertEq(c, caller); assertEq(amt, 5e6); assertTrue(closeLong);
        assertEq(uint8(st), uint8(CallStake.State.Open)); assertEq(tp, 850_000);
        assertEq(token.balanceOf(address(cs)), 5e6);
    }

    function test_rejectsATpTooCloseToTheMark() public {
        ex.setMark(846_000); // TP 850_000 is 0.47% above: under the 0.5% minimum
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CallStake.TooCloseToMark.selector, 846_000, 850_000));
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
        ex.setMark(845_000); // 0.59%: allowed
        vm.prank(owner);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_rejectsAShortTpTooCloseToTheMark() public {
        ex.setOrder(7, 3, 30_000, 100); // close-short TP at 830_000
        ex.setMark(833_000); // 0.36% above the TP
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CallStake.TooCloseToMark.selector, 833_000, 830_000));
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_rejectsAnOrderThatIsNotAClose() public {
        ex.setOrder(7, 0, 50_000, 100);
        vm.prank(owner);
        vm.expectRevert(CallStake.NotAClose.selector);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_rejectsSomeoneElsesOrder() public {
        ex.setAccount(stranger, 9);
        token.mint(stranger, 10e6);
        vm.startPrank(stranger);
        token.approve(address(cs), type(uint256).max);
        vm.expectRevert(CallStake.NotYourOrder.selector);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_rejectsAFilledOrCancelledOrder() public {
        ex.setOrder(7, 2, 50_000, 0);
        vm.prank(owner);
        vm.expectRevert(CallStake.NotYourOrder.selector);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_oneStakePerCall() public {
        _stake();
        vm.prank(owner);
        vm.expectRevert(CallStake.StakeExists.selector);
        cs.stake(id, caller, 5e6, 16, 138, uint64(block.timestamp + 1 days));
    }

    function test_releaseBeforeTheHitReverts() public {
        _stake();
        vm.expectRevert(abi.encodeWithSelector(CallStake.NotHit.selector, 840_000, 850_000));
        cs.release(id);
    }

    function test_hitPaysTheCallerOnce() public {
        _stake();
        ex.setMark(850_000);
        vm.prank(stranger); // anyone can release
        cs.release(id);
        assertEq(token.balanceOf(caller), 5e6);
        assertEq(token.balanceOf(address(cs)), 0);
        vm.expectRevert(CallStake.NotOpen.selector);
        cs.release(id);
    }

    function test_shortTpHitsAtOrBelow() public {
        ex.setOrder(7, 3, 30_000, 100); // close-short TP at 830_000
        ex.setMark(840_000); // 1.2% above the TP at stake time
        _stake();
        ex.setMark(830_001);
        vm.expectRevert(abi.encodeWithSelector(CallStake.NotHit.selector, 830_001, 830_000));
        cs.release(id);
        ex.setMark(830_000);
        cs.release(id);
        assertEq(token.balanceOf(caller), 5e6);
    }

    function test_refundOnlyAfterExpiryAndNeverAfterPaid() public {
        _stake();
        vm.expectRevert(CallStake.NotExpired.selector);
        cs.refund(id);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(CallStake.Expired.selector);
        cs.release(id);
        cs.refund(id);
        assertEq(token.balanceOf(owner), 1_000e6);
        vm.expectRevert(CallStake.NotOpen.selector);
        cs.refund(id);
    }

    /// Release succeeds exactly when the mark has crossed the TP on the order's side, and moves exactly the stake.
    function testFuzz_releaseIffCrossed(uint24 priceONS, uint256 mark, bool closeLong, uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        mark = bound(mark, 0, 2_000_000);
        ex.setOrder(7, closeLong ? 2 : 3, priceONS, 100);
        uint256 tpAtStake = uint256(priceONS) + 800_000;
        ex.setMark(closeLong ? (tpAtStake * 9_900) / 10_000 : (tpAtStake * 10_100) / 10_000); // 1% away at stake time
        vm.prank(owner);
        cs.stake(id, caller, amount, 16, 138, uint64(block.timestamp + 1 days));
        uint256 tp = uint256(priceONS) + 800_000;
        ex.setMark(mark);
        bool crossed = closeLong ? mark >= tp : mark <= tp;
        if (!crossed) vm.expectRevert(abi.encodeWithSelector(CallStake.NotHit.selector, mark, tp));
        cs.release(id);
        assertEq(token.balanceOf(caller), crossed ? amount : 0);
        assertEq(token.balanceOf(address(cs)), crossed ? 0 : amount);
    }
}
