MSM5205 ADPCM adaptation
=======================

The portable decoder in web/msm5205audioengine.js follows libvgm emu/cores/msm5205.c (BSD-3-Clause): ADPCM step table, leaky accumulator, 8-slot FIFO, reset, prescaler, 3/4-bit mode and external VCLK.

Source: https://github.com/ValleyBell/libvgm/blob/master/emu/cores/msm5205.c
VGM command: https://github.com/ValleyBell/libvgm/blob/master/player/vgmplayer_cmdhandler.cpp

Output masking does not stop decoder progression, so live mute/unmute retains timing. MSM6585 and a second chip are not supported.
